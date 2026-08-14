const http = require('http');

function post(port, path, data) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify(data);
        const options = {
            hostname: 'localhost',
            port: port,
            path: path,
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
        };
        const req = http.request(options, (res) => {
            let responseData = '';
            res.on('data', (d) => responseData += d);
            res.on('end', () => {
                try { resolve({ status: res.statusCode, body: JSON.parse(responseData) }); }
                catch(e) { resolve({ status: res.statusCode, body: responseData }); }
            });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

async function run() {
    const ports = [3000, 3001];
    const emails = ['jas@gmail.com'];
    const passwords = ['password123', 'Password123', '123456', 'admin123'];

    for (const port of ports) {
        for (const email of emails) {
            for (const password of passwords) {
                try {
                    const r = await post(port, '/api/login', { email, password });
                    console.log(`PORT:${port} ${email}/${password} => HTTP${r.status} ${JSON.stringify(r.body)}`);
                    if (r.status === 200) process.exit(0);
                } catch(e) {
                    console.log(`PORT:${port} ${email} => ERROR:${e.message}`);
                }
            }
        }
    }
    process.exit(0);
}
run();
