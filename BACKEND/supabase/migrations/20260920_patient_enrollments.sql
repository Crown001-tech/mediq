-- ==========================================================
-- MEDIQ: Doctor-Initiated Patient Enrollment Migration
-- Run this script in your Supabase SQL Editor
-- ==========================================================

-- 1. Create enrollments table
CREATE TABLE IF NOT EXISTS public.enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  patient_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  invite_code VARCHAR(16) UNIQUE NOT NULL,
  patient_phone VARCHAR(32),
  patient_name VARCHAR(128),
  initial_notes TEXT,
  status VARCHAR(24) DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'completed', 'discontinued')),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '14 days'),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  enrolled_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Performance indexes
CREATE INDEX IF NOT EXISTS idx_enrollments_code ON public.enrollments(invite_code);
CREATE INDEX IF NOT EXISTS idx_enrollments_doctor ON public.enrollments(doctor_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_patient ON public.enrollments(patient_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_status ON public.enrollments(status);

-- 3. Row Level Security
ALTER TABLE public.enrollments ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if re-running
DROP POLICY IF EXISTS "Doctors manage their own enrollments" ON public.enrollments;
DROP POLICY IF EXISTS "Patients view their own enrollments" ON public.enrollments;

-- Doctors can view, create, and update their own created enrollments
CREATE POLICY "Doctors manage their own enrollments" ON public.enrollments
  FOR ALL USING (auth.uid() = doctor_id)
  WITH CHECK (auth.uid() = doctor_id);

-- Patients can view their claimed enrollments
CREATE POLICY "Patients view their own enrollments" ON public.enrollments
  FOR SELECT USING (auth.uid() = patient_id);

-- 4. Atomic verification function (Safe for client/public query during patient signup)
CREATE OR REPLACE FUNCTION public.verify_enrollment_code(p_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rec RECORD;
  v_doc RECORD;
BEGIN
  SELECT * INTO v_rec FROM public.enrollments WHERE UPPER(invite_code) = UPPER(TRIM(p_code));
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'NOT_FOUND');
  END IF;

  IF v_rec.status = 'active' THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'ALREADY_CLAIMED');
  END IF;

  IF v_rec.status != 'pending' THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'INVALID_STATUS');
  END IF;

  IF v_rec.expires_at < NOW() THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'EXPIRED', 'expires_at', v_rec.expires_at);
  END IF;

  -- Fetch Doctor Public Demographics
  SELECT full_name, specialty INTO v_doc FROM public.profiles WHERE id = v_rec.doctor_id;

  RETURN jsonb_build_object(
    'valid', true,
    'code', v_rec.invite_code,
    'doctor_id', v_rec.doctor_id,
    'doctor_name', COALESCE(v_doc.full_name, 'Attending Physician'),
    'doctor_specialty', COALESCE(v_doc.specialty, 'General Practice'),
    'patient_name_hint', v_rec.patient_name,
    'expires_at', v_rec.expires_at
  );
END;
$$;

-- 5. Atomic claim function (Executes claim transaction safely with row locking)
CREATE OR REPLACE FUNCTION public.claim_enrollment_invite(p_code TEXT, p_patient_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rec RECORD;
  v_doc RECORD;
BEGIN
  -- Lock the row to prevent race conditions / duplicate claims
  SELECT * INTO v_rec FROM public.enrollments 
  WHERE UPPER(invite_code) = UPPER(TRIM(p_code))
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_FOUND');
  END IF;

  IF v_rec.status = 'active' THEN
    RETURN jsonb_build_object('success', false, 'error', 'ALREADY_CLAIMED');
  END IF;

  IF v_rec.expires_at < NOW() THEN
    RETURN jsonb_build_object('success', false, 'error', 'EXPIRED');
  END IF;

  -- Update row to active and bind to patient
  UPDATE public.enrollments
  SET patient_id = p_patient_id,
      status = 'active',
      enrolled_at = NOW(),
      updated_at = NOW()
  WHERE id = v_rec.id;

  -- Fetch doctor info for notifications
  SELECT full_name, specialty INTO v_doc FROM public.profiles WHERE id = v_rec.doctor_id;

  RETURN jsonb_build_object(
    'success', true,
    'doctor_id', v_rec.doctor_id,
    'doctor_name', COALESCE(v_doc.full_name, 'Attending Physician'),
    'enrollment_id', v_rec.id
  );
END;
$$;
