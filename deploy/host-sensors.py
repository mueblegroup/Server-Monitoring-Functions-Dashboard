#!/usr/bin/env python3
"""Read-only Linux hwmon endpoint. Run on the physical Proxmox host."""
import hmac
import json
import os
from pathlib import Path
import socket
import subprocess
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def read_sensors(root=Path('/sys/class/hwmon')):
    result = {'node': os.environ.get('SENSOR_NODE', socket.gethostname().split('.')[0]),
              'temperatures': [], 'fans': [], 'power': []}
    for device in sorted(root.glob('hwmon*')):
        try:
            chip = (device / 'name').read_text().strip()
        except OSError:
            chip = device.name
        for pattern, key, unit, scale in [('temp*_input', 'temperatures', 'celsius', 1000),
                                           ('fan*_input', 'fans', 'rpm', 1),
                                           ('power*_input', 'power', 'watts', 1000000),
                                           ('power*_average', 'power', 'watts', 1000000)]:
            for sensor in sorted(device.glob(pattern)):
                try:
                    number = float(sensor.read_text().strip()) / scale
                    label_file = sensor.with_name(sensor.name.replace('_input', '_label'))
                    label = label_file.read_text().strip() if label_file.exists() else sensor.stem.replace('_input', '')
                    if (unit == 'celsius' and -50 <= number <= 200) or (unit in ('rpm', 'watts') and 0 <= number <= 100000):
                        result[key].append({'label': f'{chip}: {label}', unit: number})
                except (OSError, ValueError):
                    continue
    if os.environ.get('SENSOR_IPMI', '').lower() == 'true':
        try:
            output = subprocess.run(['ipmitool', '-I', 'open', 'sensor'],
                                    capture_output=True, text=True, timeout=8, check=True).stdout
            for line in output.splitlines():
                fields = [field.strip() for field in line.split('|')]
                if len(fields) < 4 or fields[3].lower() not in ('ok', 'cr', 'nc', 'nr'):
                    continue
                try:
                    value = float(fields[1])
                except ValueError:
                    continue
                label = 'IPMI: ' + fields[0][:80]
                unit = fields[2].lower()
                if unit == 'degrees c' and -50 <= value <= 200:
                    row = {'label': label, 'celsius': value}
                    if len(fields) > 7:
                        try:
                            row['warningCelsius'] = float(fields[7])
                        except ValueError:
                            pass
                    result['temperatures'].append(row)
                elif unit == 'rpm' and 0 <= value <= 100000:
                    result['fans'].append({'label': label, 'rpm': value})
                elif unit in ('percent', '%') and 'fan' in fields[0].lower() and 0 <= value <= 100:
                    result['fans'].append({'label': label, 'percent': value})
                elif unit == 'watts' and 0 <= value <= 100000:
                    result['power'].append({'label': label, 'watts': value})
        except (OSError, subprocess.SubprocessError):
            pass  # hwmon still works when IPMI is unavailable or access is denied.
    return result


def main():
    token = os.environ.get('SENSOR_TOKEN', '')
    if len(token) < 24:
        raise SystemExit('Set SENSOR_TOKEN to a secret of at least 24 characters.')

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            expected = ('Bearer ' + token).encode()
            if not hmac.compare_digest(self.headers.get('Authorization', '').encode(), expected):
                self.send_error(401)
                return
            if self.path != '/metrics':
                self.send_error(404)
                return
            body = json.dumps(read_sensors(), allow_nan=False).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):
            pass  # Never log request headers or credentials.

    ThreadingHTTPServer((os.environ.get('SENSOR_HOST', '127.0.0.1'),
                         int(os.environ.get('SENSOR_PORT', '9109'))), Handler).serve_forever()


if __name__ == '__main__':
    main()
