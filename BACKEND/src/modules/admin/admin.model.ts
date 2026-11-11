import fs from 'fs';
import path from 'path';
import { supabaseAdmin } from '../../config/supabase.js';
import { PatientAssignment, ReassignmentRecord } from '../../common/types/index.js';
import { formatDoctorName } from '../../common/utils/string.util.js';
import { resolveDataPath } from '../../common/utils/path.util.js';

const assignmentsFile = resolveDataPath('patient_doctor_assignments.json');
const historyFile = resolveDataPath('reassignment_history.json');

function getStoredAssignments(): PatientAssignment[] {
  try {
    if (fs.existsSync(assignmentsFile)) {
      const raw = fs.readFileSync(assignmentsFile, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (err) {
    console.error('Error reading assignments store:', err);
  }
  return [];
}

function saveStoredAssignments(list: PatientAssignment[]) {
  try {
    fs.writeFileSync(assignmentsFile, JSON.stringify(list, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error saving assignments store:', err);
  }
}

function getStoredHistory(): ReassignmentRecord[] {
  try {
    if (fs.existsSync(historyFile)) {
      const raw = fs.readFileSync(historyFile, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (err) {
    console.error('Error reading reassignment history store:', err);
  }
  return [];
}

function saveStoredHistory(list: ReassignmentRecord[]) {
  try {
    fs.writeFileSync(historyFile, JSON.stringify(list, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error saving reassignment history store:', err);
  }
}

export class AdminModel {
  /**
   * Aggregates active patient-doctor assignments from enrollments, care_plans, cases, and file cache
   */
  static async getPatientAssignments(): Promise<PatientAssignment[]> {
    const assignments: PatientAssignment[] = [];
    const seen = new Set<string>();

    // 1. Fetch from enrollments table (primary source of truth)
    try {
      const { data: enrolls } = await supabaseAdmin
        .from('enrollments')
        .select('patient_id, doctor_id, status')
        .not('patient_id', 'is', null)
        .order('created_at', { ascending: false });

      if (enrolls) {
        for (const en of enrolls) {
          if (en.patient_id && en.doctor_id && !seen.has(en.patient_id)) {
            assignments.push({
              patient_id: en.patient_id,
              doctor_id: en.doctor_id,
              status: en.status || 'active',
            });
            seen.add(en.patient_id);
          }
        }
      }
    } catch (err) {
      console.warn('Enrollments query notice:', err);
    }

    // 2. Fetch from care_plans table
    try {
      const { data: plans } = await supabaseAdmin
        .from('care_plans')
        .select('patient_id, doctor_id, active')
        .not('patient_id', 'is', null)
        .order('created_at', { ascending: false });

      if (plans) {
        for (const cp of plans) {
          if (cp.patient_id && cp.doctor_id && !seen.has(cp.patient_id)) {
            assignments.push({
              patient_id: cp.patient_id,
              doctor_id: cp.doctor_id,
              status: cp.active ? 'active' : 'completed',
            });
            seen.add(cp.patient_id);
          }
        }
      }
    } catch (err) {
      console.warn('Care plans query notice:', err);
    }

    // 3. Fetch from cases table
    try {
      const { data: cases } = await supabaseAdmin
        .from('cases')
        .select('patient_id, doctor_id, status')
        .not('doctor_id', 'is', null)
        .not('patient_id', 'is', null)
        .order('created_at', { ascending: false });

      if (cases) {
        for (const c of cases) {
          if (c.patient_id && c.doctor_id && !seen.has(c.patient_id)) {
            assignments.push({
              patient_id: c.patient_id,
              doctor_id: c.doctor_id,
              status: c.status === 'closed' ? 'completed' : 'active',
            });
            seen.add(c.patient_id);
          }
        }
      }
    } catch (err) {
      console.warn('Cases query notice:', err);
    }

    // 4. Secondary fallback to local file store
    try {
      const fileAssignments = getStoredAssignments();
      if (Array.isArray(fileAssignments)) {
        for (const item of fileAssignments) {
          if (item.patient_id && item.doctor_id && !seen.has(item.patient_id)) {
            assignments.push({
              patient_id: item.patient_id,
              doctor_id: item.doctor_id,
              status: item.status || 'active',
            });
            seen.add(item.patient_id);
          }
        }
      }
    } catch (err) {
      console.error('Error reading local assignments file:', err);
    }

    return assignments;
  }

  /**
   * Retrieve clinical handover audit trail
   */
  static getReassignmentHistory(): ReassignmentRecord[] {
    return getStoredHistory();
  }

  /**
   * Execute clinical patient reassignment with multi-party notifications and audit log
   */
  static async reassignPatient(input: {
    patientId: string;
    newDoctorId: string;
    oldDoctorId?: string | null;
    adminId?: string;
    handoverNotes?: string;
    patientName?: string;
    newDoctorName?: string;
    oldDoctorName?: string;
  }) {
    const {
      patientId,
      newDoctorId,
      oldDoctorId,
      adminId = 'admin',
      handoverNotes = '',
      patientName = 'Patient',
      newDoctorName = 'Attending Physician',
      oldDoctorName = 'Previous Physician',
    } = input;

    const cleanNewDoctorName = formatDoctorName(newDoctorName);
    const cleanOldDoctorName = formatDoctorName(oldDoctorName);
    const trimmedNotes = handoverNotes.trim();

    // 1. Update persistent assignments list
    const assignments = getStoredAssignments();
    const existingIndex = assignments.findIndex((a) => a.patient_id === patientId);
    const assignmentEntry: PatientAssignment = {
      patient_id: patientId,
      doctor_id: newDoctorId,
      patient_name: patientName,
      doctor_name: cleanNewDoctorName,
      status: 'active',
      updated_at: new Date().toISOString(),
    };

    if (existingIndex >= 0) {
      assignments[existingIndex] = assignmentEntry;
    } else {
      assignments.push(assignmentEntry);
    }
    saveStoredAssignments(assignments);

    // 2. Append to clinical handover audit log
    const history = getStoredHistory();
    const auditRecord: ReassignmentRecord = {
      id: `reassign_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      patient_id: patientId,
      patient_name: patientName,
      old_doctor_id: oldDoctorId || null,
      old_doctor_name: cleanOldDoctorName || 'Unassigned / Prior Physician',
      new_doctor_id: newDoctorId,
      new_doctor_name: cleanNewDoctorName,
      notes: trimmedNotes || 'Clinical care transfer authorized by Hospital Administration',
      admin_id: adminId,
      created_at: new Date().toISOString(),
    };
    history.unshift(auditRecord);
    saveStoredHistory(history);

    // 3. Dispatch in-app notifications to all 3 parties
    const notificationPromises = [];

    // Party A: Previous Doctor (if one existed and is different)
    if (oldDoctorId && oldDoctorId !== newDoctorId) {
      const oldDocMsg = `Patient ${patientName} has been reassigned to ${cleanNewDoctorName}. Clinical handover notes: ${
        trimmedNotes || 'No specific notes provided by administration.'
      }`;
      notificationPromises.push(
        supabaseAdmin.from('notifications').insert({
          user_id: oldDoctorId,
          type: 'handover',
          message: oldDocMsg,
          read: false,
        })
      );
    }

    // Party B: New Doctor
    const newDocMsg = `Patient ${patientName} has been assigned to your clinical roster from ${cleanOldDoctorName}. Handover notes: ${
      trimmedNotes || 'Clinical care transfer authorized by Hospital Administration.'
    }`;
    notificationPromises.push(
      supabaseAdmin.from('notifications').insert({
        user_id: newDoctorId,
        type: 'assignment',
        message: newDocMsg,
        read: false,
      })
    );

    // Party C: Patient
    const patientMsg = `Your attending physician has been updated to ${cleanNewDoctorName}.${
      trimmedNotes ? ` Handover notes: ${trimmedNotes}` : ''
    }`;
    notificationPromises.push(
      supabaseAdmin.from('notifications').insert({
        user_id: patientId,
        type: 'system',
        message: patientMsg,
        read: false,
      })
    );

    // 4. Update Supabase database entities
    try {
      await supabaseAdmin
        .from('enrollments')
        .update({
          doctor_id: newDoctorId,
          initial_notes: `[Reassigned by Admin]: ${trimmedNotes || 'Clinical handover'}`,
          updated_at: new Date().toISOString(),
        })
        .eq('patient_id', patientId);

      await supabaseAdmin
        .from('care_plans')
        .update({ doctor_id: newDoctorId })
        .eq('patient_id', patientId)
        .eq('active', true);

      await supabaseAdmin
        .from('cases')
        .update({ doctor_id: newDoctorId })
        .eq('patient_id', patientId)
        .in('status', ['pending', 'in_review']);
    } catch (dbErr) {
      console.warn('Database entities update warning:', dbErr);
    }

    await Promise.allSettled(notificationPromises);

    return {
      success: true,
      message: `Successfully reassigned ${patientName} to ${cleanNewDoctorName}.`,
      auditRecord,
    };
  }

  /**
   * Approve, reject, or revoke a doctor's credential status
   */
  static async verifyDoctor(doctorId: string, action: 'approve' | 'reject' | 'revoke') {
    let updateData: Record<string, any> = {};
    let notifMessage = '';

    if (action === 'approve') {
      updateData = { verified: true, role: 'doctor' };
      notifMessage = 'Your medical staff credential application has been approved. You now have full clinical access.';
    } else if (action === 'reject') {
      updateData = { verified: false, role: 'rejected' };
      notifMessage = 'Your medical staff credential application was not approved by the clinical directorate.';
    } else if (action === 'revoke') {
      updateData = { verified: false };
      notifMessage = 'Your medical staff clinical verification credentials have been revoked by administration.';
    }

    const { data: updatedProfile, error: updateError } = await supabaseAdmin
      .from('profiles')
      .update(updateData)
      .eq('id', doctorId)
      .select()
      .single();

    if (updateError) {
      throw new Error(updateError.message);
    }

    // Send in-app notification to the doctor
    try {
      await supabaseAdmin.from('notifications').insert({
        user_id: doctorId,
        title: 'Credentialing Status Update',
        message: notifMessage,
        type: 'credential_update',
        read: false,
      });
    } catch (notifErr) {
      console.warn('Failed to send notification to doctor:', notifErr);
    }

    return updatedProfile;
  }
}
