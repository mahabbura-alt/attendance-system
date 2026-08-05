require('dotenv').config();
const { uploadFoto } = require('../services/storage');

async function test() {
  const dummyBuffer = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP...', 'base64');
  console.log('Testing uploadFoto with dummy Buffer...');
  const res = await uploadFoto(dummyBuffer, { userId: 'test_user', jenis: 'datang' });
  console.log('RESULT URL:', res);
  process.exit(0);
}

test().catch(e => { console.error(e); process.exit(1); });
