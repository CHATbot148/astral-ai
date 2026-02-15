-- Allow users to delete messages in their own conversations (needed for edit functionality)
CREATE POLICY "Users can delete messages in own conversations"
ON public.messages
FOR DELETE
USING (EXISTS (
  SELECT 1 FROM conversations
  WHERE conversations.id = messages.conversation_id
  AND conversations.user_id = auth.uid()
));