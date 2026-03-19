const nodemailer = require('nodemailer');

const ALERT_EMAIL_FROM = process.env.ALERT_EMAIL_FROM;
const ALERT_EMAIL_APP_PASSWORD = process.env.ALERT_EMAIL_APP_PASSWORD;
const ALERT_RECIPIENTS = [
    'mohit.mandal@univest.in',
    'sumit.kumar@univest.in',
    'ripal.vachher@univest.in',
    'yash.agarwal@univest.in'
];

const SHEET_ID = '15cUn1ykWCttlk4G1y2SvT2yKoceRqsHRYJEnWeqzEIk';
const SHEET_NAME = 'Creative Performance Tracker-Auto';

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: ALERT_EMAIL_FROM, pass: ALERT_EMAIL_APP_PASSWORD }
});

async function fetchSheet() {
    const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(SHEET_NAME)}`;
    const resp = await fetch(url);
    const text = await resp.text();
    const jsonStr = text.replace(/^[^(]*\(/, '').replace(/\);?\s*$/, '');
    const json = JSON.parse(jsonStr);
    const headers = json.table.cols.map(c => (c.label || '').trim());
    return json.table.rows.map(row => {
        const obj = {};
        row.c.forEach((cell, i) => {
            if (headers[i]) obj[headers[i]] = cell ? (cell.v != null ? cell.v : '') : '';
        });
        return obj;
    });
}

function num(v) {
    if (v == null || v === '' || v === '-') return 0;
    if (typeof v === 'number') return v;
    return parseFloat(String(v).replace(/[₹,%\s]/g, '')) || 0;
}

function pct(v) {
    if (v == null || v === '' || v === '-') return 0;
    if (typeof v === 'number') return v > 1 ? v : v * 100;
    const n = parseFloat(String(v).replace(/[%\s]/g, ''));
    return n > 1 ? n : n * 100;
}

function parseDate(str) {
    if (!str) return 0;
    if (str instanceof Date) return str.getTime();
    if (typeof str === 'string') {
        const parts = str.split('/');
        if (parts.length === 3) return new Date(parts[2], parts[1] - 1, parts[0]).getTime();
        return new Date(str).getTime() || 0;
    }
    return 0;
}

function classify(rows) {
    const now = Date.now();
    const fourteenDays = 14 * 86400000;

    const creatives = rows
        .filter(r => {
            const name = r['Creative Name'] || '';
            const live = r['Live?'] || '';
            const spent = num(r['Spent (15k min)']);
            return name.startsWith('FB_') && live === 'Live' && spent >= 15000;
        })
        .map(r => {
            const goLive = parseDate(r['Date - Go Live']);
            const matured = goLive && (now - goLive) >= fourteenDays;
            const spent = num(r['Spent (15k min)']);
            const signups = num(r['Signups']) || 1;
            const d0Trials = num(r['D0_Trials']) || 1;
            const d6 = num(r['D6']) || 1;
            const signupCost = spent / signups;
            const d0TrialCost = spent / d0Trials;
            const d6CAC = spent / d6;
            const d6ROAS = pct(r['D6 ROAS (overall)']);
            const d6CACMatured = num(r['D6 CAC matured']);
            const d6ROASMatured = pct(r['D6 ROAS overall (matured)']);

            return {
                name: r['Creative Name'],
                spent, signupCost, d0TrialCost,
                d6CAC: matured ? (d6CACMatured || d6CAC) : d6CAC,
                d6ROAS: matured ? (d6ROASMatured || d6ROAS) : d6ROAS,
                matured,
                signups: num(r['Signups']),
                d0Trials: num(r['D0_Trials']),
                d6Count: num(r['D6']),
                overallROAS: pct(r['Overall ROAS']),
            };
        });

    const red = creatives.filter(d => {
        if (d.d6ROAS > 28) return false;
        let b = 0;
        if (d.signupCost > 1000) b++;
        if (d.d0TrialCost > 3500) b++;
        if (d.d6CAC > 15000) b++;
        return b >= 2;
    });

    const green = creatives.filter(d => {
        if (d.d6ROAS > 28) return true;
        let h = 0;
        if (d.signupCost > 0 && d.signupCost < 500) h++;
        if (d.d0TrialCost > 0 && d.d0TrialCost < 2500) h++;
        if (d.d6CAC > 0 && d.d6CAC < 12000) h++;
        return h >= 2;
    });

    return { red, green };
}

function inr(v) {
    if (!v || v === Infinity) return '-';
    return '₹' + Math.round(v).toLocaleString('en-IN');
}

function buildHTML(red, green) {
    const date = new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    const header = `<tr style="background:#1a1a2e;border-bottom:2px solid #444;">
        <th style="padding:10px;text-align:left;color:#fff;">Creative</th>
        <th style="padding:10px;text-align:left;color:#fff;">Spend</th>
        <th style="padding:10px;text-align:left;color:#fff;">Signup Cost</th>
        <th style="padding:10px;text-align:left;color:#fff;">D0 Trial Cost</th>
        <th style="padding:10px;text-align:left;color:#fff;">D6 CAC</th>
        <th style="padding:10px;text-align:left;color:#fff;">D6 ROAS</th>
        <th style="padding:10px;text-align:left;color:#fff;">Flags</th>
    </tr>`;

    const redRows = red.map(d => {
        const flags = [];
        if (d.signupCost > 1000) flags.push('Signup Cost > ₹1K');
        if (d.d0TrialCost > 3500) flags.push('D0 Trial > ₹3.5K');
        if (d.d6CAC > 15000) flags.push('D6 CAC > ₹15K');
        return `<tr style="border-bottom:1px solid #333;">
            <td style="padding:10px;color:#ff4d4d;font-weight:600;">${d.name}${d.matured ? ' <span style="color:#888;font-size:11px;">(Mat.)</span>' : ''}</td>
            <td style="padding:10px;color:#e0e0e0;">${inr(d.spent)}</td>
            <td style="padding:10px;color:#e0e0e0;">${inr(d.signupCost)}</td>
            <td style="padding:10px;color:#e0e0e0;">${inr(d.d0TrialCost)}</td>
            <td style="padding:10px;color:#e0e0e0;">${inr(d.d6CAC)}</td>
            <td style="padding:10px;color:#e0e0e0;">${d.d6ROAS ? d.d6ROAS.toFixed(1) + '%' : '-'}</td>
            <td style="padding:10px;color:#ff4d4d;">${flags.join(', ')}</td>
        </tr>`;
    }).join('');

    const greenRows = green.map(d => {
        const flags = [];
        if (d.d6ROAS > 28) flags.push('D6 ROAS > 28%');
        if (d.signupCost > 0 && d.signupCost < 500) flags.push('Signup < ₹500');
        if (d.d0TrialCost > 0 && d.d0TrialCost < 2500) flags.push('D0 Trial < ₹2.5K');
        if (d.d6CAC > 0 && d.d6CAC < 12000) flags.push('D6 CAC < ₹12K');
        return `<tr style="border-bottom:1px solid #333;">
            <td style="padding:10px;color:#00c853;font-weight:600;">${d.name}${d.matured ? ' <span style="color:#888;font-size:11px;">(Mat.)</span>' : ''}</td>
            <td style="padding:10px;color:#e0e0e0;">${inr(d.spent)}</td>
            <td style="padding:10px;color:#e0e0e0;">${inr(d.signupCost)}</td>
            <td style="padding:10px;color:#e0e0e0;">${inr(d.d0TrialCost)}</td>
            <td style="padding:10px;color:#e0e0e0;">${inr(d.d6CAC)}</td>
            <td style="padding:10px;color:#e0e0e0;">${d.d6ROAS ? d.d6ROAS.toFixed(1) + '%' : '-'}</td>
            <td style="padding:10px;color:#00c853;">${flags.join(', ')}</td>
        </tr>`;
    }).join('');

    return `
    <div style="font-family:'Inter',Arial,sans-serif;background:#08080d;color:#e0e0e0;padding:24px;max-width:900px;margin:0 auto;">
        <h1 style="color:#fff;font-size:22px;margin-bottom:4px;">Creative Performance Alerts</h1>
        <p style="color:#888;font-size:13px;margin-bottom:24px;">${date} &bull; Live Creatives Only (Spend &ge; &#8377;15K)</p>

        <div style="margin-bottom:32px;">
            <h2 style="color:#ff4d4d;font-size:16px;margin-bottom:12px;">&#9888; Red Alerts (${red.length})</h2>
            ${red.length
                ? `<table style="width:100%;border-collapse:collapse;font-size:13px;background:#111;border-radius:8px;overflow:hidden;">${header}${redRows}</table>`
                : '<p style="color:#666;font-size:13px;">No red alerts — all creatives within benchmarks.</p>'}
        </div>

        <div style="margin-bottom:32px;">
            <h2 style="color:#00c853;font-size:16px;margin-bottom:12px;">&#9989; Green Alerts (${green.length})</h2>
            ${green.length
                ? `<table style="width:100%;border-collapse:collapse;font-size:13px;background:#111;border-radius:8px;overflow:hidden;">${header}${greenRows}</table>`
                : '<p style="color:#666;font-size:13px;">No green alerts found.</p>'}
        </div>

        <p style="color:#555;font-size:11px;border-top:1px solid #333;padding-top:12px;margin-top:24px;">
            Auto-generated by Creative Portal &bull; <a href="https://kabiragarwal-77777.github.io/creative-portal/" style="color:#6c63ff;">Open Dashboard</a>
        </p>
    </div>`;
}

async function main() {
    console.log('Fetching sheet data...');
    const rows = await fetchSheet();
    console.log(`Fetched ${rows.length} rows`);

    const { red, green } = classify(rows);
    console.log(`Red: ${red.length}, Green: ${green.length}`);

    if (red.length === 0 && green.length === 0) {
        console.log('No alerts to send');
        return;
    }

    const html = buildHTML(red, green);
    const subject = `Creative Alerts: ${red.length} Red, ${green.length} Green — ${new Date().toLocaleDateString('en-IN')}`;

    await transporter.sendMail({
        from: `"Creative Portal" <${ALERT_EMAIL_FROM}>`,
        to: ALERT_RECIPIENTS.join(', '),
        subject,
        html
    });

    console.log(`Email sent to ${ALERT_RECIPIENTS.length} recipients`);
}

main().catch(err => {
    console.error('Alert failed:', err.message);
    process.exit(1);
});
