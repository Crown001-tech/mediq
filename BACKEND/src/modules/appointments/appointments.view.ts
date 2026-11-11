import { StoredAppointment } from '../../common/types/index.js';

export class AppointmentsView {
  static renderList(appointments: StoredAppointment[]) {
    return {
      success: true,
      appointments,
      total: appointments.length,
    };
  }

  static renderItem(appointment: StoredAppointment) {
    return {
      success: true,
      appointment,
    };
  }
}
