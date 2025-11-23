const axios = require('axios');

const BASE_URL = 'http://localhost:3000/api';

async function testValidation() {
    console.log('Starting Validation Test...');

    // Test Case 1: Missing all fields
    try {
        console.log('\n[TEST] Case 1: Missing all fields');
        await axios.post(`${BASE_URL}/user/link-email`, {});
        console.error('❌ Failed: Should have returned 400');
    } catch (error) {
        if (error.response && error.response.status === 400) {
            console.log('✅ Passed: Returned 400 as expected');
            console.log('   Error:', error.response.data);
        } else {
            console.error('❌ Failed: Unexpected error', error.message);
        }
    }

    // Test Case 2: Invalid Email
    try {
        console.log('\n[TEST] Case 2: Invalid Email');
        await axios.post(`${BASE_URL}/user/link-email`, {
            phone: '5511999999999',
            token: 'validtoken123',
            email: 'invalid-email',
            password: 'password123'
        });
        console.error('❌ Failed: Should have returned 400');
    } catch (error) {
        if (error.response && error.response.status === 400) {
            const details = error.response.data.details || [];
            if (details.some(d => d.includes('Email inválido'))) {
                console.log('✅ Passed: Detected invalid email');
            } else {
                console.error('❌ Failed: Did not detect invalid email', error.response.data);
            }
        } else {
            console.error('❌ Failed: Unexpected error', error.message);
        }
    }

    // Test Case 3: Short Password
    try {
        console.log('\n[TEST] Case 3: Short Password');
        await axios.post(`${BASE_URL}/user/link-email`, {
            phone: '5511999999999',
            token: 'validtoken123',
            email: 'test@example.com',
            password: '123'
        });
        console.error('❌ Failed: Should have returned 400');
    } catch (error) {
        if (error.response && error.response.status === 400) {
            const details = error.response.data.details || [];
            if (details.some(d => d.includes('mínimo 6 caracteres'))) {
                console.log('✅ Passed: Detected short password');
            } else {
                console.error('❌ Failed: Did not detect short password', error.response.data);
            }
        } else {
            console.error('❌ Failed: Unexpected error', error.message);
        }
    }

    console.log('\nValidation Tests Completed.');
}

testValidation();
