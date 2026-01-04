-- Make chat-files bucket public so images can be displayed
UPDATE storage.buckets SET public = true WHERE id = 'chat-files';

-- Add UPDATE policy for users to update their own files
CREATE POLICY "Users can update own files"
ON storage.objects FOR UPDATE
USING (bucket_id = 'chat-files' AND (auth.uid())::text = (storage.foldername(name))[1]);

-- Add DELETE policy for users to delete their own files  
CREATE POLICY "Users can delete own files"
ON storage.objects FOR DELETE
USING (bucket_id = 'chat-files' AND (auth.uid())::text = (storage.foldername(name))[1]);

-- Public read access for chat-files bucket (needed for avatars/attachments display)
CREATE POLICY "Public read access for chat-files"
ON storage.objects FOR SELECT
USING (bucket_id = 'chat-files');