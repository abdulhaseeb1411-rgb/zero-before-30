-- Prevent two concurrent requests from reserving the same client request.
-- Partial index preserves support for legacy/null request IDs.
create unique index if not exists input_events_user_client_request_uidx
  on public.input_events (user_id, client_request_id)
  where client_request_id is not null;
