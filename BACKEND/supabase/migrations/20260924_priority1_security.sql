-- ==============================================================================
-- MEDIQ: PRIORITY 1 — CRITICAL SECURITY MIGRATION (2026-09-24)
-- Run this script in your Supabase SQL Editor:
-- Dashboard > SQL Editor > New Query > Paste & Run
-- ==============================================================================

-- ==============================================================================
-- 1. PROFILES TABLE: RLS PRIVILEGE ESCALATION FIX & ROLE PROTECTION TRIGGER
-- ==============================================================================

-- Drop the overly permissive public update policy
DROP POLICY IF EXISTS "Allow public update to profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Admins can update any profile" ON public.profiles;

-- 1.1 Policy: Authenticated users can only update their own profile row
CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- 1.2 Policy: Administrators can update any profile (e.g. for credentialing)
CREATE POLICY "Admins can update any profile" ON public.profiles
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );

-- 1.3 Trigger: Prevent regular client-side updates from changing role or verified
CREATE OR REPLACE FUNCTION public.protect_profile_roles()
RETURNS TRIGGER AS $$
BEGIN
  -- If role or verified is modified
  IF (OLD.role IS DISTINCT FROM NEW.role OR OLD.verified IS DISTINCT FROM NEW.verified) THEN
    -- Check if executing context is service_role or admin
    IF (
      auth.jwt() ->> 'role' = 'service_role'
      OR EXISTS (
        SELECT 1 FROM public.profiles 
        WHERE id = auth.uid() AND role = 'admin'
      )
    ) THEN
      -- Authorized: accept the change
      RETURN NEW;
    ELSE
      -- Unauthorized: silently retain original values (preventing privilege escalation)
      NEW.role := OLD.role;
      NEW.verified := OLD.verified;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_protect_profile_roles ON public.profiles;
CREATE TRIGGER trg_protect_profile_roles
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_profile_roles();

-- ==============================================================================
-- 2. APPOINTMENTS TABLE: SECURE VIDEO ROOM TOKEN COLUMN
-- ==============================================================================

-- Add video_room_token column to store a 32+ character cryptographically random token
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS video_room_token VARCHAR(64);

-- Backfill existing appointments with a secure 64-character random token
UPDATE public.appointments 
SET video_room_token = replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
WHERE video_room_token IS NULL;

-- Performance Index
CREATE INDEX IF NOT EXISTS idx_appointments_video_room_token ON public.appointments(video_room_token);

-- ==============================================================================
-- 3. NOTIFICATIONS TABLE: RESTRICT INSERT TO SERVER-SIDE SERVICE ROLE & RECIPIENTS
-- ==============================================================================

-- Drop open insert policy
DROP POLICY IF EXISTS "Allow system insert notifications" ON public.notifications;
DROP POLICY IF EXISTS "Service role insert notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users can view own notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users can update own notifications" ON public.notifications;

-- 3.1 Policy: Users can view their own notifications
CREATE POLICY "Users can view own notifications" ON public.notifications
  FOR SELECT
  USING (auth.uid() = user_id);

-- 3.2 Policy: Users can mark their own notifications as read
CREATE POLICY "Users can update own notifications" ON public.notifications
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 3.3 Policy: Only service_role (or admins) can insert notifications
CREATE POLICY "Service role insert notifications" ON public.notifications
  FOR INSERT
  WITH CHECK (
    auth.jwt() ->> 'role' = 'service_role'
    OR EXISTS (
      SELECT 1 FROM public.profiles 
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- =====================================================
-- SECTION 4: REALTIME REPLICATION CONFIGURATION
-- Ensure case_messages and responses stream live updates to active clients
-- =====================================================
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.case_messages;
  EXCEPTION WHEN duplicate_object THEN
    NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.responses;
  EXCEPTION WHEN duplicate_object THEN
    NULL;
  END;
END $$;

