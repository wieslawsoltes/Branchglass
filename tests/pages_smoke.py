#!/usr/bin/env python3
"""Check the built static app or its deployed Pages URL with real navigation.

Run after npm run vendor && npm run build:pages. Requires Python Playwright
and its Chromium browser. No repository credentials or user folders are used.
"""
import argparse
import functools
import http.server
import json
import os
from pathlib import Path
import shutil
import tempfile
import threading
import time
from urllib.parse import urljoin, urlsplit
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--url', help='An already deployed site; otherwise serve _site under /Branchglass/.')
parser.add_argument('--chromium', default=None)
parser.add_argument('--expected-commit', default=os.environ.get('GITHUB_SHA'))
args = parser.parse_args()
results_dir = ROOT / 'docs/results'
shots = ROOT / 'docs/screenshots'
results_dir.mkdir(parents=True, exist_ok=True)
shots.mkdir(parents=True, exist_ok=True)
checks = []

def passed(name):
    checks.append({'test': name, 'pass': True})
    print('PASS', name, flush=True)

def wait(page, expression, timeout=20):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if page.evaluate('() => (' + expression + ')'):
            return
        page.wait_for_timeout(50)
    raise AssertionError('Timed out waiting for: ' + expression)

with tempfile.TemporaryDirectory(prefix='branchglass-pages-') as temp:
    server = None
    if args.url:
        url = args.url.rstrip('/') + '/'
    else:
        shutil.copytree(ROOT / '_site', Path(temp) / 'Branchglass')
        handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=temp)
        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        url = f'http://127.0.0.1:{server.server_port}/Branchglass/'
    report_name = 'pages-live' if args.url else 'pages-local'
    errors = []
    failures = []
    report = {'url': url, 'checks': checks, 'page_errors': errors, 'request_failures': failures,
              'hardware_gpu_claim': False}
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path=args.chromium)
            page = browser.new_page(viewport={'width': 1720, 'height': 1080})
            page.set_default_timeout(15000)
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.on('requestfailed', lambda request: failures.append({'url': request.url, 'error': request.failure}))
            # Require the built app to work without a third-party CDN fallback.
            origin = urlsplit(url).netloc
            page.route('**/*', lambda route: route.continue_() if urlsplit(route.request.url).netloc == origin else route.abort())
            response = page.goto(url, wait_until='networkidle', timeout=60000)
            assert response and response.status == 200, 'The application document did not return HTTP 200.'
            wait(page, '!!window.Branchglass && document.querySelectorAll(".diff-row").length > 0')
            report['browser'] = browser.version
            report['diagnostics'] = page.evaluate('() => Branchglass.diagnostics()')
            assert report['diagnostics']['provider'] == 'demo', report['diagnostics']
            assert report['diagnostics']['commits'] > 0, report['diagnostics']
            assert report['diagnostics']['historyDOM'] < 60, report['diagnostics']
            assert report['diagnostics']['graph'] in ['WebGPU', 'Canvas 2D', 'webgpu', 'canvas2d', 'canvas'], report['diagnostics']
            passed('Static project-path boot renders history and diffs')
            metadata = page.request.get(urljoin(url, 'build.json'))
            assert metadata.status == 200
            report['build'] = metadata.json()
            if args.expected_commit:
                assert report['build']['commit'] == args.expected_commit, report['build']
            passed('Build manifest identifies the expected source commit')
            page.screenshot(path=str(shots / (report_name + '-dark.png')))
            page.locator('[data-action=theme]').click()
            assert page.locator('html').get_attribute('data-theme') == 'light'
            page.screenshot(path=str(shots / (report_name + '-light.png')))
            page.locator('[data-action=theme]').click()
            passed('Both themes render on the static site')
            page.locator('[data-action=palette]').click()
            page.locator('#palette-query').fill('Rendering diagnostics')
            page.locator('#palette-query').press('Enter')
            page.locator('#dialog[open]').wait_for()
            assert 'Engine, in plain sight' in page.locator('#dialog').inner_text()
            page.locator('#dialog [data-action=closeDialog]').click()
            passed('Command palette and rendering diagnostics are interactive')
            page.locator('.rail-button[data-view=files]').click()
            page.locator('.file-row').first.wait_for()
            page.locator('.rail-button[data-view=history]').click()
            page.locator('#history-scroll').wait_for()
            passed('File workspace and history navigation work')
            version = page.evaluate('''async () => {
                const {loadBrowserGit} = await import('./core/providers.js');
                const git = await loadBrowserGit();
                return git.version();
            }''')
            assert version == '1.41.9', version
            report['browser_git_version'] = version
            passed('Pinned browser Git loads from the deployed site without a CDN')
            assert not errors, errors
            assert not failures, failures
            passed('No uncaught browser errors or failed requests')
            report['success'] = True
            browser.close()
    except Exception as error:
        report['success'] = False
        report['error'] = str(error)
        raise
    finally:
        (results_dir / (report_name + '.json')).write_text(json.dumps(report, indent=2) + '\n', encoding='utf8')
        if server:
            server.shutdown()
    print('TOTAL', len(checks), 'static-site checks passed', flush=True)
