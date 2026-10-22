const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const BACKUP_DIR = 'E:\\prime_view_backups\\reset-backup-20261022';

function getEnvVar(key) {
  const envContent = fs.readFileSync(path.join(__dirname, '../../.env'), 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith(key + '=')) {
      let val = trimmed.substring(key.length + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.substring(1, val.length - 1);
      }
      return val;
    }
  }
  return null;
}

const supabaseUrl = getEnvVar('SUPABASE_URL') || 'https://nnuyccntmxhrkbbsnmwn.supabase.co';
const supabaseKey = getEnvVar('SUPABASE_SERVICE_ROLE_KEY') || getEnvVar('SUPABASE_ANON_KEY');

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
});

async function main() {
  const manifestPath = path.join(BACKUP_DIR, 'storage_objects_manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

  console.log(`Checking sizes for ${manifest.uniqueStorageObjects.length} storage objects in bucket 'receipts'...`);

  let totalBytes = 0;
  const objectDetails = [];

  for (const item of manifest.uniqueStorageObjects) {
    // List file in bucket to get metadata
    const { data, error } = await supabase.storage.from(item.bucket).list('', {
      search: item.key,
    });

    let size = null;
    let found = false;
    if (data && data.length > 0) {
      const match = data.find((f) => f.name === item.key);
      if (match && match.metadata) {
        size = match.metadata.size;
        totalBytes += size;
        found = true;
      }
    }

    objectDetails.push({
      bucket: item.bucket,
      key: item.key,
      sizeBytes: size,
      sizeKb: size !== null ? (size / 1024).toFixed(1) : 'unknown',
      foundInBucket: found,
      slipNumber: item.slipNumber || 'none',
    });
  }

  console.log('\n--- Object Details ---');
  for (const [idx, o] of objectDetails.entries()) {
    console.log(`[${String(idx + 1).padStart(2)}] bucket="${o.bucket}", key="${o.key}", size=${o.sizeKb} KB, found=${o.foundInBucket}`);
  }

  console.log(`\nTotal objects to delete : ${objectDetails.length}`);
  console.log(`Total verified size     : ${(totalBytes / 1024 / 1024).toFixed(2)} MB (${totalBytes.toLocaleString()} bytes)`);

  fs.writeFileSync(
    path.join(BACKUP_DIR, 'storage_deletion_target_list.json'),
    JSON.stringify({ totalCount: objectDetails.length, totalBytes, totalMb: (totalBytes / 1024 / 1024).toFixed(2), objects: objectDetails }, null, 2),
    'utf-8'
  );
}

main().catch(console.error);
