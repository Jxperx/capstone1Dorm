const http = require('http');

function createTenant(data) {
  const postData = JSON.stringify(data);

  const options = {
    hostname: 'localhost',
    port: 3000,
    path: '/api/admin/create-account',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData)
    }
  };

  const req = http.request(options, (res) => {
    let responseBody = '';
    res.on('data', (chunk) => {
      responseBody += chunk;
    });
    res.on('end', () => {
      console.log(`Status: ${res.statusCode}`);
      console.log(`Response: ${responseBody}`);
    });
  });

  req.on('error', (e) => {
    console.error(`Problem with request: ${e.message}`);
  });

  req.write(postData);
  req.end();
}

// Test Case 1: Valid Tenant with Phone
const test1 = {
  full_name: 'Test Tenant 1',
  email: 'test_tenant_' + Date.now() + '@example.com',
  password: 'password123',
  phone: '09123456789',
  room_id: '', // Empty string as from select
  lease_start: ''
};

console.log('Testing valid tenant with phone...');
createTenant(test1);
