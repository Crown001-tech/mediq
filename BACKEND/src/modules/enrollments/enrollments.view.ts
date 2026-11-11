export class EnrollmentsView {
  static renderVerifyResult(result: any) {
    return result;
  }

  static renderClaimResult(result: any) {
    return {
      success: true,
      ...result,
    };
  }
}
