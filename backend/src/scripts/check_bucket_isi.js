require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL || 'https://lpezydpyzvfydbhwimqq.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function run() {
  const { data, error } = await supabase.storage
    .from('absensi-foto')
    .list('absensi', { limit: 20, sortBy: { column: 'created_at', order: 'desc' } });

  if (error) {
    console.error('❌ Gagal list files:', error.message);
    return;
  }

  if (!data || data.length === 0) {
    console.log('📭 Bucket masih KOSONG - belum ada foto yang diupload via Vercel');
  } else {
    console.log(`📸 Ada ${data.length} folder/file di bucket:`);
    data.forEach(item => console.log(` - ${item.name} (${item.metadata?.size || '?'} bytes)`));
  }
  await require('../config/db').pool.end().catch(() => {});
}
run();
