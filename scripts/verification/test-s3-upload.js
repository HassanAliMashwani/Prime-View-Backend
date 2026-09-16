const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

async function runS3Test() {
  console.log('Testing S3Client presigned URL generation and upload...');
  
  const supabaseProjectRef = 'nnuyccntmxhrkbbsnmwn';
  
  const s3Client = new S3Client({
    region: 'ap-northeast-1',
    endpoint: `https://${supabaseProjectRef}.storage.supabase.co/storage/v1/s3`,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
    forcePathStyle: true,
  });

  const bucket = 'public-media';
  const key = `test-${Date.now()}.jpg`;
  
  try {
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: 'image/jpeg',
    });
    
    console.log('Generating presigned URL...');
    const url = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
    console.log('Generated URL:', url);
    
    console.log('\nUploading test file...');
    const fetch = globalThis.fetch;
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'image/jpeg',
      },
      body: 'FAKE_JPEG_IMAGE_DATA_BYTES_FOR_TESTING',
    });
    
    console.log('Upload Response Status:', response.status);
    console.log('Upload Response Text:', await response.text());
    
  } catch (err) {
    console.error('Error:', err);
  }
}

runS3Test();
