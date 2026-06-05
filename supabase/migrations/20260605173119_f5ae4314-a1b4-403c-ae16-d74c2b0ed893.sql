
DROP POLICY IF EXISTS "chat-files: public read individual objects" ON storage.objects;

CREATE POLICY "chat-files: owner read"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'chat-files'
  AND (storage.foldername(name))[1] = auth.uid()::text
);
