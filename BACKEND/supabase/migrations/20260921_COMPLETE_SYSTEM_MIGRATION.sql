-- ==============================================================================
-- MEDIQ COMPREHENSIVE SYSTEM MIGRATION (2026-09-21)
-- Copy and paste this entire script into your Supabase Project SQL Editor.
-- This script is completely idempotent (safe to run multiple times).
-- ==============================================================================

-- ==============================================================================
-- 1. ENROLLMENTS TABLE (Doctor-Led Patient Onboarding & Status Management)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invite_code VARCHAR(16) UNIQUE NOT NULL,
  doctor_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  patient_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  patient_name VARCHAR(255) NOT NULL,
  patient_phone VARCHAR(50),
  notes TEXT,
  initial_notes TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'discontinued')),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ensure initial_notes column exists if table was previously created without it
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'enrollments' AND column_name = 'initial_notes'
  ) THEN
    ALTER TABLE public.enrollments ADD COLUMN initial_notes TEXT;
  END IF;
END $$;

-- Performance Indexes
CREATE INDEX IF NOT EXISTS idx_enrollments_code ON public.enrollments(invite_code);
CREATE INDEX IF NOT EXISTS idx_enrollments_doctor ON public.enrollments(doctor_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_patient ON public.enrollments(patient_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_status ON public.enrollments(status);

-- Enable RLS
ALTER TABLE public.enrollments ENABLE ROW LEVEL SECURITY;

-- Enrollment RLS Policies
DROP POLICY IF EXISTS "Doctors manage their own enrollments" ON public.enrollments;
DROP POLICY IF EXISTS "Patients view their own enrollments" ON public.enrollments;
DROP POLICY IF EXISTS "Admins manage all enrollments" ON public.enrollments;

CREATE POLICY "Doctors manage their own enrollments" ON public.enrollments
  FOR ALL USING (auth.uid() = doctor_id);

CREATE POLICY "Patients view their own enrollments" ON public.enrollments
  FOR SELECT USING (auth.uid() = patient_id);

CREATE POLICY "Admins manage all enrollments" ON public.enrollments
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
    )
  );

-- ==============================================================================
-- 2. CARE PLANS ADMIN POLICIES
-- ==============================================================================

DROP POLICY IF EXISTS "Admins manage all care plans" ON public.care_plans;

CREATE POLICY "Admins manage all care plans" ON public.care_plans
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
    )
  );

-- ==============================================================================
-- 3. CASE MESSAGES (Continuous 2-Way Mobile Chat Thread)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.case_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID REFERENCES public.cases(id) ON DELETE CASCADE NOT NULL,
  sender_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  sender_role VARCHAR(20) NOT NULL CHECK (sender_role IN ('doctor', 'patient')),
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  read_at TIMESTAMPTZ
);

-- Performance Indexes
CREATE INDEX IF NOT EXISTS idx_case_messages_case ON public.case_messages(case_id);
CREATE INDEX IF NOT EXISTS idx_case_messages_created ON public.case_messages(created_at);

-- Enable RLS
ALTER TABLE public.case_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Case participants can view messages" ON public.case_messages;
DROP POLICY IF EXISTS "Case participants can insert messages" ON public.case_messages;
DROP POLICY IF EXISTS "Admins can view case messages" ON public.case_messages;

CREATE POLICY "Case participants can view messages" ON public.case_messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.cases c
      WHERE c.id = case_id
      AND (c.patient_id = auth.uid() OR c.doctor_id = auth.uid())
    )
  );

CREATE POLICY "Case participants can insert messages" ON public.case_messages
  FOR INSERT WITH CHECK (
    auth.uid() = sender_id
    AND EXISTS (
      SELECT 1 FROM public.cases c
      WHERE c.id = case_id
      AND (c.patient_id = auth.uid() OR c.doctor_id = auth.uid() OR c.doctor_id IS NULL)
    )
  );

CREATE POLICY "Admins can view case messages" ON public.case_messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
    )
  );

-- ==============================================================================
-- 4. NOTIFICATIONS TABLE & POLICIES
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  title TEXT,
  message TEXT NOT NULL,
  type VARCHAR(50) DEFAULT 'general',
  read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ensure title column exists if table was previously created without it
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'notifications' AND column_name = 'title'
  ) THEN
    ALTER TABLE public.notifications ADD COLUMN title TEXT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_notifications_user ON public.notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_created ON public.notifications(created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON public.notifications(user_id, read);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view their own notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users and doctors insert notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users update their own notifications" ON public.notifications;

CREATE POLICY "Users view their own notifications" ON public.notifications
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users and doctors insert notifications" ON public.notifications
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Users update their own notifications" ON public.notifications
  FOR UPDATE USING (auth.uid() = user_id);

-- ==============================================================================
-- 5. ATOMIC RPC FUNCTION: claim_enrollment_invite
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.claim_enrollment_invite(
  p_code TEXT,
  p_patient_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rec RECORD;
  v_doc_name TEXT;
  v_doc_spec TEXT;
BEGIN
  -- 1. Validate Invite Code
  SELECT * INTO v_rec FROM public.enrollments 
  WHERE UPPER(invite_code) = UPPER(TRIM(p_code));

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_CODE', 'message', 'This invitation code does not exist.');
  END IF;

  IF v_rec.status != 'active' THEN
    RETURN jsonb_build_object('success', false, 'error', 'EXPIRED_OR_COMPLETED', 'message', 'This invitation has already been completed.');
  END IF;

  IF v_rec.expires_at IS NOT NULL AND v_rec.expires_at < NOW() THEN
    RETURN jsonb_build_object('success', false, 'error', 'EXPIRED', 'message', 'This invitation code has expired.');
  END IF;

  -- 2. Bind Patient to Enrollment
  UPDATE public.enrollments
  SET 
    patient_id = p_patient_id,
    updated_at = NOW()
  WHERE id = v_rec.id;

  -- 3. Fetch Doctor Profile info
  SELECT full_name, specialty INTO v_doc_name, v_doc_spec 
  FROM public.profiles 
  WHERE id = v_rec.doctor_id;

  RETURN jsonb_build_object(
    'success', true,
    'enrollment_id', v_rec.id,
    'doctor_id', v_rec.doctor_id,
    'doctor_name', COALESCE(v_doc_name, 'Attending Physician'),
    'doctor_specialty', COALESCE(v_doc_spec, 'General Practice')
  );
END;
$$;

-- ==============================================================================
-- 6. ATOMIC RPC FUNCTION: admin_reassign_patient
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.admin_reassign_patient(
  p_patient_id UUID,
  p_new_doctor_id UUID,
  p_admin_id UUID,
  p_notes TEXT DEFAULT 'Reassigned by Hospital Administration'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_doc_name TEXT;
  v_patient_name TEXT;
  v_old_doc_id UUID;
BEGIN
  -- Verify caller is admin
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_admin_id AND role = 'admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'UNAUTHORIZED');
  END IF;

  SELECT full_name INTO v_new_doc_name FROM public.profiles WHERE id = p_new_doctor_id;
  SELECT full_name INTO v_patient_name FROM public.profiles WHERE id = p_patient_id;

  -- 1. Update active enrollment
  SELECT doctor_id INTO v_old_doc_id 
  FROM public.enrollments 
  WHERE patient_id = p_patient_id AND status = 'active'
  LIMIT 1;

  UPDATE public.enrollments
  SET 
    doctor_id = p_new_doctor_id,
    initial_notes = COALESCE(initial_notes, '') || ' [Reassigned by Admin]: ' || p_notes,
    updated_at = NOW()
  WHERE patient_id = p_patient_id AND status = 'active';

  -- If no active enrollment existed, insert one
  IF NOT FOUND THEN
    INSERT INTO public.enrollments (
      invite_code, doctor_id, patient_id, patient_name, notes, initial_notes, status
    ) VALUES (
      UPPER(SUBSTRING(MD5(RANDOM()::TEXT) FROM 1 FOR 8)),
      p_new_doctor_id,
      p_patient_id,
      COALESCE(v_patient_name, 'Patient'),
      p_notes,
      '[Admin Assigned]: ' || p_notes,
      'active'
    );
  END IF;

  -- 2. Update active care plans
  UPDATE public.care_plans
  SET 
    doctor_id = p_new_doctor_id,
    details = COALESCE(details, '') || ' — [Transferred to Dr. ' || COALESCE(v_new_doc_name, 'Physician') || ' by Admin]'
  WHERE patient_id = p_patient_id AND active = TRUE;

  -- 3. Update pending/in-review cases
  UPDATE public.cases
  SET doctor_id = p_new_doctor_id
  WHERE patient_id = p_patient_id AND status IN ('pending', 'in_review');

  -- 4. Send Notifications
  INSERT INTO public.notifications (user_id, title, message, type)
  VALUES (
    p_patient_id,
    'Attending Physician Updated',
    'Your clinical care has been reassigned to Dr. ' || COALESCE(v_new_doc_name, 'Physician') || '. ' || p_notes,
    'enrollment'
  );

  INSERT INTO public.notifications (user_id, title, message, type)
  VALUES (
    p_new_doctor_id,
    'Patient Assigned to Your Care',
    'Hospital administration has assigned ' || COALESCE(v_patient_name, 'a patient') || ' to your active roster. Handover notes: ' || p_notes,
    'enrollment'
  );

  RETURN jsonb_build_object(
    'success', true,
    'patient_id', p_patient_id,
    'new_doctor_id', p_new_doctor_id,
    'new_doctor_name', v_new_doc_name
  );
END;
$$;
