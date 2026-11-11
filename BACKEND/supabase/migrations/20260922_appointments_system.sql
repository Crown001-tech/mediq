-- ==========================================================
-- MEDIQ: Telehealth & Appointments System Migration
-- Run this script in your Supabase SQL Editor
-- ==========================================================

CREATE TABLE IF NOT EXISTS public.appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  doctor_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  case_id UUID REFERENCES public.cases(id) ON DELETE SET NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'upcoming' CHECK (status IN ('upcoming', 'completed', 'cancelled')),
  type VARCHAR(30) NOT NULL DEFAULT 'video' CHECK (type IN ('video', 'in_person', 'follow_up')),
  reason TEXT,
  doctor_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ensure optional columns exist if previously created with partial schema
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'appointments' AND column_name = 'type'
  ) THEN
    ALTER TABLE public.appointments ADD COLUMN type VARCHAR(30) DEFAULT 'video';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'appointments' AND column_name = 'reason'
  ) THEN
    ALTER TABLE public.appointments ADD COLUMN reason TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'appointments' AND column_name = 'doctor_notes'
  ) THEN
    ALTER TABLE public.appointments ADD COLUMN doctor_notes TEXT;
  END IF;
END $$;

-- Performance Indexes
CREATE INDEX IF NOT EXISTS idx_appointments_patient ON public.appointments(patient_id);
CREATE INDEX IF NOT EXISTS idx_appointments_doctor ON public.appointments(doctor_id);
CREATE INDEX IF NOT EXISTS idx_appointments_scheduled ON public.appointments(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_appointments_status ON public.appointments(status);

-- Enable RLS
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if re-running
DROP POLICY IF EXISTS "Patients view their own appointments" ON public.appointments;
DROP POLICY IF EXISTS "Patients create their own appointments" ON public.appointments;
DROP POLICY IF EXISTS "Patients update their own appointments" ON public.appointments;
DROP POLICY IF EXISTS "Doctors manage their own appointments" ON public.appointments;
DROP POLICY IF EXISTS "Admins manage all appointments" ON public.appointments;

-- Patient Policies
CREATE POLICY "Patients view their own appointments" ON public.appointments
  FOR SELECT USING (auth.uid() = patient_id);

CREATE POLICY "Patients create their own appointments" ON public.appointments
  FOR INSERT WITH CHECK (auth.uid() = patient_id);

CREATE POLICY "Patients update their own appointments" ON public.appointments
  FOR UPDATE USING (auth.uid() = patient_id);

-- Doctor Policies
CREATE POLICY "Doctors manage their own appointments" ON public.appointments
  FOR ALL USING (auth.uid() = doctor_id)
  WITH CHECK (auth.uid() = doctor_id);

-- Admin Policies
CREATE POLICY "Admins manage all appointments" ON public.appointments
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );
