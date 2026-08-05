/**
 * Ensure Supabase Storage public bucket "absensi-foto" exists
 */
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://lpezydpyzvfydbhwimqq.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function run() {
  console.log('⚡ Initializing Supabase Storage bucket "absensi-foto"...');

  const { data: buckets, error: listErr } = await supabase.storage.listBuckets();
  if (listErr) {
    console.error('❌ List Buckets Error:', listErr.message);
    return;
  }

  const exists = buckets.some(b => b.name === 'absensi-foto');
  if (!exists) {
    const { data, error } = await supabase.storage.createBucket('absensi-foto', {
      public: true,
      allowedMimeTypes: ['image/jpeg', 'image/png'],
    });
    if (error) {
      console.error('❌ Create Bucket Error:', error.message);
    } else {
      console.log('✅ Bucket "absensi-foto" created successfully on Supabase Storage!');
    }
  } else {
    console.log('✅ Bucket "absensi-foto" already exists on Supabase Storage!');
  }
}

run();
