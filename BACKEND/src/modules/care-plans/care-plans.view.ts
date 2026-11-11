export class CarePlansView {
  static parseDuration(instructions?: string | null, planCreatedAt?: string | null) {
    const defaultRes = {
      durationText: 'Ongoing / Chronic',
      isCompleted: false,
      currentDay: 1,
      totalDays: null,
      progressText: 'Active Chronic Regimen',
    };

    if (!instructions) return defaultRes;

    const match = instructions.match(/Duration:\s*([^•]+)/i);
    const rawDuration = match ? match[1].trim() : '';

    if (!rawDuration || rawDuration.toLowerCase().includes('ongoing') || rawDuration.toLowerCase().includes('chronic')) {
      return defaultRes;
    }

    const daysMatch = rawDuration.match(/(\d+)\s*Days?/i);
    if (daysMatch) {
      const totalDays = parseInt(daysMatch[1], 10);
      const startDate = planCreatedAt ? new Date(planCreatedAt).getTime() : Date.now();
      const elapsedDays = Math.max(1, Math.ceil((Date.now() - startDate) / (24 * 60 * 60 * 1000)));
      const isCompleted = elapsedDays > totalDays;

      return {
        durationText: `${totalDays} Days`,
        isCompleted,
        currentDay: Math.min(elapsedDays, totalDays),
        totalDays,
        progressText: isCompleted ? 'Course Completed' : `Day ${elapsedDays} of ${totalDays}`,
      };
    }

    return {
      durationText: rawDuration,
      isCompleted: false,
      currentDay: 1,
      totalDays: null,
      progressText: 'Active Regimen',
    };
  }

  static renderList(plans: any[]) {
    const enriched = plans.map((p) => ({
      ...p,
      durationInfo: CarePlansView.parseDuration(p.instructions, p.created_at),
    }));

    return {
      success: true,
      care_plans: enriched,
      total: enriched.length,
    };
  }

  static renderItem(plan: any) {
    if (!plan) return { success: false, error: 'Care plan not found' };

    return {
      success: true,
      care_plan: {
        ...plan,
        durationInfo: CarePlansView.parseDuration(plan.instructions, plan.created_at),
      },
    };
  }
}
