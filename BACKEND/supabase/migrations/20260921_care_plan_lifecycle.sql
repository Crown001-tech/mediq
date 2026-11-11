-- ==========================================================
-- MEDIQ: Care Plan Lifecycle & Admin Reassignment Migration
-- Run this script in your Supabase SQL Editor
-- ==========================================================

-- 1. Ensure enrollments status includes 'completed' and 'discontinued'
-- (Already in check constraint: status IN ('pending', 'active', 'completed', 'discontinued'))

-- 2. Add Admin RLS Policies for enrollments
DROP POLICY IF EXISTS "Admins manage all enrollments" ON public.enrollments;
CREATE POLICY "Admins manage all enrollments" ON public.enrollments
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );

-- 3. Add Admin RLS Policies for care_plans
DROP POLICY IF EXISTS "Admins manage all care plans" ON public.care_plans;
CREATE POLICY "Admins manage all care plans" ON public.care_plans
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );

-- 4. Atomic Admin Patient Reassignment RPC Function
CREATE OR REPLACE FUNCTION public.admin_reassign_patient(
  p_patient_id UUID,
  p_new_doctor_id UUID,
  p_admin_id UUID,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_old_doctor_id UUID;
  v_patient_name TEXT;
  v_new_doc_name TEXT;
  v_admin_role TEXT;
BEGIN
  -- Verify caller is admin
  SELECT role INTO v_admin_role FROM public.profiles WHERE id = p_admin_id;
  IF v_admin_role != 'admin' THEN
    RETURN jsonb_build_object('success', false, 'error', 'UNAUTHORIZED_NOT_ADMIN');
  END IF;

  -- Verify new doctor is a verified doctor
  SELECT full_name INTO v_new_doc_name 
  FROM public.profiles 
  WHERE id = p_new_doctor_id AND role = 'doctor' AND verified = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_TARGET_DOCTOR');
  END IF;

  -- Get patient name
  SELECT full_name INTO v_patient_name FROM public.profiles WHERE id = p_patient_id;

  -- Find existing active enrollment to identify old doctor
  SELECT doctor_id INTO v_old_doctor_id 
  FROM public.enrollments 
  WHERE patient_id = p_patient_id AND status = 'active'
  LIMIT 1;

  -- 1. Update active enrollment(s) to new doctor
  UPDATE public.enrollments
  SET 
    doctor_id = p_new_doctor_id,
    initial_notes = CASE 
      WHEN p_notes IS NOT NULL AND p_notes != '' 
      THEN COALESCE(initial_notes, '') || E'\n[Reassigned by Admin]: ' || p_notes
      ELSE initial_notes
    END,
    updated_at = NOW()
  WHERE patient_id = p_patient_id AND status = 'active';

  -- If no active enrollment existed, create a direct active enrollment record
  IF NOT FOUND THEN
    INSERT INTO public.enrollments (
      doctor_id,
      patient_id,
      invite_code,
      patient_name,
      initial_notes,
      status,
      enrolled_at
    ) VALUES (
      p_new_doctor_id,
      p_patient_id,
      UPPER(SUBSTRING(MD5(RANDOM()::TEXT) FROM 1 FOR 8)),
      v_patient_name,
      COALESCE(p_notes, 'Transferred by Hospital Administration'),
      'active',
      NOW()
    );
  END IF;

  -- 2. Update active care plans to new doctor
  UPDATE public.care_plans
  SET doctor_id = p_new_doctor_id
  WHERE patient_id = p_patient_id AND active = true;

  -- 3. Reassign pending / in-review clinical cases
  UPDATE public.cases
  SET doctor_id = p_new_doctor_id
  WHERE patient_id = p_patient_id AND status IN ('pending', 'in_review');

  -- 4. Notify new doctor
  INSERT INTO public.notifications (
    user_id,
    title,
    message,
    type,
    created_at
  ) VALUES (
    p_new_doctor_id,
    'Patient Reassigned to Your Panel',
    COALESCE(v_patient_name, 'A patient') || ' has been reassigned to your care panel by Hospital Administration.' ||
    CASE WHEN p_notes IS NOT NULL AND p_notes != '' THEN ' Note: ' || p_notes ELSE '' END,
    'assignment',
    NOW()
  );

  -- 5. Notify patient
  INSERT INTO public.notifications (
    user_id,
    title,
    message,
    type,
    created_at
  ) VALUES (
    p_patient_id,
    'Attending Physician Updated',
    'Your attending care physician has been updated to Dr. ' || COALESCE(v_new_doc_name, 'your new doctor') || '.',
    'system',
    NOW()
  );

  RETURN jsonb_build_object(
    'success', true,
    'patient_id', p_patient_id,
    'new_doctor_id', p_new_doctor_id,
    'new_doctor_name', v_new_doc_name
  );
END;
$$;
