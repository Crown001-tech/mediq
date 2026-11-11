-- ==========================================================
-- MEDIQ: Continuous 2-Way Follow-Up Thread Migration
-- Run this script in your Supabase SQL Editor
-- ==========================================================

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

-- Row Level Security
ALTER TABLE public.case_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Case participants can view messages" ON public.case_messages;
DROP POLICY IF EXISTS "Case participants can insert messages" ON public.case_messages;

-- Allow participants of the case (assigned doctor or patient) to view messages
CREATE POLICY "Case participants can view messages" ON public.case_messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.cases c
      WHERE c.id = case_id
      AND (c.patient_id = auth.uid() OR c.doctor_id = auth.uid())
    )
  );

-- Allow participants to insert messages
CREATE POLICY "Case participants can insert messages" ON public.case_messages
  FOR INSERT WITH CHECK (
    auth.uid() = sender_id
    AND EXISTS (
      SELECT 1 FROM public.cases c
      WHERE c.id = case_id
      AND (c.patient_id = auth.uid() OR c.doctor_id = auth.uid())
    )
  );
