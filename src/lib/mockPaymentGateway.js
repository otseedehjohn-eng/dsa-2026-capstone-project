export function createMockPaymentGateway() {
  return {
    async charge({ amountCents, decline = false }) {
      if (decline) {
        return { success: false };
      }
      return { success: true, amountCents };
    },
  };
}
