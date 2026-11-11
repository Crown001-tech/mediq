import { PatientAssignment, ReassignmentRecord } from '../../common/types/index.js';

export class AdminView {
  static renderAssignments(assignments: PatientAssignment[]) {
    return {
      success: true,
      assignments,
      total: assignments.length,
    };
  }

  static renderHistory(history: ReassignmentRecord[]) {
    return {
      success: true,
      history,
      total: history.length,
    };
  }

  static renderReassignResult(result: any) {
    return result;
  }

  static renderVerifyDoctorResult(profile: any) {
    return {
      success: true,
      profile,
    };
  }
}
