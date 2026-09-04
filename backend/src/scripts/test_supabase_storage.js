require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://lpezydpyzvfydbhwimqq.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function run() {
  console.log('Testing Supabase Storage upload...');
  console.log('URL:', SUPABASE_URL);
  console.log('Key (last 8):', SUPABASE_KEY.slice(-8));

  // Test 1: List buckets
  const { data: buckets, error: bucketErr } = await supabase.storage.listBuckets();
  if (bucketErr) {
    console.error('❌ List buckets FAILED:', bucketErr.message);
  } else {
    console.log('✅ Buckets found:', buckets.map(b => b.name));
  }

  // Test 2: Upload small test file
  const testBuffer = Buffer.from('test-image-data-png-placeholder');
  const testKey = `test/test-${Date.now()}.jpg`;
  const { data, error } = await supabase.storage
    .from('absensi-foto')
    .upload(testKey, testBuffer, { contentType: 'image/jpeg', upsert: true });

  if (error) {
    console.error('❌ Upload test FAILED:', error.message, error.statusCode);
  } else {
    const { data: urlData } = supabase.storage.from('absensi-foto').getPublicUrl(testKey);
    console.log('✅ Upload SUCCESS! Public URL:', urlData.publicUrl);
    // cleanup
    await supabase.storage.from('absensi-foto').remove([testKey]);
    console.log('🗑️ Test file cleaned up.');
  }
}

run().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
