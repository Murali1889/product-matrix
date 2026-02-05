import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Server-side Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_KEY || ''
);

const isConfigured = () => {
  return (
    process.env.SUPABASE_URL &&
    process.env.SUPABASE_SERVICE_KEY &&
    process.env.SUPABASE_URL.startsWith('https://')
  );
};

// POST - Upload video/attachment to Supabase Storage
export async function POST(request: Request) {
  if (!isConfigured()) {
    return NextResponse.json(
      { error: 'Supabase not configured' },
      { status: 503 }
    );
  }

  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const type = formData.get('type') as string; // 'video' or 'attachment'

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    const timestamp = Date.now();
    const sanitizedName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
    const folder = type === 'video' ? 'videos' : 'attachments';
    const fileName = `${folder}/${timestamp}-${sanitizedName}`;

    // Convert File to ArrayBuffer for upload
    const arrayBuffer = await file.arrayBuffer();
    const buffer = new Uint8Array(arrayBuffer);

    const { error: uploadError } = await supabase.storage
      .from('feedback-media')
      .upload(fileName, buffer, {
        contentType: file.type,
        cacheControl: '3600',
      });

    if (uploadError) {
      console.error('Upload error:', uploadError);

      // If bucket doesn't exist, return a helpful error
      if (uploadError.message.includes('not found')) {
        return NextResponse.json({
          error: 'Storage bucket "feedback-media" not found. Please create it in Supabase Dashboard > Storage.',
          details: uploadError.message
        }, { status: 500 });
      }

      return NextResponse.json({ error: uploadError.message }, { status: 500 });
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('feedback-media')
      .getPublicUrl(fileName);

    return NextResponse.json({
      success: true,
      url: urlData.publicUrl,
      fileName: file.name,
      fileType: file.type,
    });
  } catch (error: any) {
    console.error('Error in POST /api/feedback/upload:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
