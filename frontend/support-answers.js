(function (root) {
    const action = (label, id) => ({ label, id });
    function answer(question, status = {}) {
        const q = String(question || '').toLowerCase();
        if (/\b(pin|otp|one.?time|password|secret)\s*(is|:|=)\s*\S+|\b\d{12,19}\b/i.test(q)) return {
            text: 'Keep your M-Pesa PIN, passwords, one-time codes and card details private. This assistant does not need them. For an order check, use your order reference and checkout email in the secure lookup form.',
            actions: [action('Check my order', 'orders')], sensitive: true
        };
        if (/refund|cancel|money back/.test(q)) return {
            text: 'Refund and cancellation eligibility depends on the event or travel supplier’s terms. Check your order first and keep its reference and payment receipt. This chat cannot approve a refund or cancel a booking. Contact support with those references and the reason for your request.',
            actions: [action('Check my order', 'orders'), action('Contact support', 'contact')]
        };
        if (/charged twice|paid twice|double|duplicate|deducted|money.*(gone|taken)|paid.*(no|missing|not)/.test(q)) return {
            text: 'Check your order before paying again. If M-Pesa shows a debit but the order is pending or tickets are missing, keep the M-Pesa receipt and order reference and contact support. A debit alone does not confirm that a ticket has been issued.',
            actions: [action('Check payment / tickets', 'orders'), action('Contact support', 'contact')]
        };
        if (/failed|declined|no prompt|not.*prompt|prompt.*not|stk|pending|processing/.test(q)) return {
            text: 'If you received a prompt, approve it on the M-Pesa phone used at checkout. For a missing prompt, confirm the phone number and mobile signal. Check the order status before retrying. If payment is still processing or your account was debited, contact support before making another payment.',
            actions: [action('Check payment status', 'orders'), action('Contact support', 'contact')]
        };
        if (/log.?in|sign.?in|register|account|google|email|password/.test(q)) {
            let text = 'Use Log in to access your account or create one with your name, email and a password of at least 12 characters.';
            if (status.auth) {
                if (!status.auth.storageAvailable) text = 'Account access is temporarily affected by the database connection. Try again after the service reconnects.';
                else text += (status.auth.google ? ' Google sign-in is available in the login form.' : ' Google sign-in is not configured yet.') +
                    (status.auth.confirmationEmail ? ' If confirmation is required, check your inbox and spam folder or resend the link from login.' : ' Confirmation-email delivery is not configured yet.');
            }
            return { text, actions: [action('Open login', 'login')] };
        }
        if (/flight|holiday|hotel|safari|jaza|installment|instalment/.test(q)) return {
            text: /jaza|installment|instalment/.test(q)
                ? 'Check the selected package’s payment terms before paying a deposit. This assistant cannot promise an instalment plan or reserve a package. The booking page shows the quote, payment options and confirmation status.'
                : 'Browse Flights or Holidays for dates, travellers, inclusions and the current quote. Review the payment and supplier-confirmation terms before paying. A saved itinerary is a plan; use your booking status to confirm whether the reservation has been fulfilled.',
            actions: [action('Browse flights', 'flights'), action('Browse holidays', 'holidays')]
        };
        if (/offline|unavailable|not working|broken|error|status|service/.test(q)) {
            const health = status.health;
            return { text: !health ? 'I could not verify the booking service just now. Check your connection and try again shortly. If you already paid, check the order before retrying payment.'
                : health.database !== 'connected' ? 'The website is responding, but the booking database is reconnecting. Accounts, checkout and order lookup may be temporarily unavailable. If you paid, keep your receipt and check the order after reconnection.'
                : health.checkout?.mode === 'live' ? 'The booking service reports a connected database and live checkout. This checks service readiness; it does not confirm an individual payment or booking.'
                : 'The database is connected, but live checkout is not ready. Browse the listings and try payment again once checkout is available.',
                actions: [action('Check again', 'status'), action('Check my order', 'orders')] };
        }
        if (/pay|m.?pesa|checkout|cart|price|cost/.test(q)) return {
            text: status.health && status.health.checkout?.mode !== 'live'
                ? 'Live checkout is currently unavailable. Keep your order reference if you already started a payment and check its status before trying again.'
                : 'Choose an event and ticket quantity, review the total, and enter your contact details and M-Pesa number at checkout. Approve the prompt on your phone. The site selects the payment provider automatically. Never share your M-Pesa PIN here.',
            actions: [action('Browse events', 'events'), action('Check payment status', 'orders')]
        };
        if (/qr|gate|ticket|order|pass|receipt|download|print/.test(q)) return {
            text: 'Open Tickets and enter the order reference and email used at checkout. Completed ticket orders show the available passes and QR codes. If a paid order has no pass, contact support with your order reference and M-Pesa receipt. Keep QR codes private.',
            actions: [action('Find my tickets', 'orders'), action('Browse events', 'events')]
        };
        if (/contact|human|agent|person|support|help desk|call|whatsapp/.test(q)) return {
            text: 'This is an automated guide, not a live agent. Use the configured support contact below. For payment queries, include your order reference and payment receipt. Never send your PIN, password or full card details.', actions: [action('Contact support', 'contact')]
        };
        if (/event|concert|venue|where|when|available/.test(q)) return {
            text: 'Browse Events to find dates, venues, ticket categories and current prices. Open the event before choosing tickets. Availability and prices can change; review the checkout total before paying.', actions: [action('Browse events', 'events')]
        };
        if (/^(hi|hello|hey|thanks|thank you)[!.\s]*$/.test(q)) return {
            text: /thank/.test(q) ? 'You’re welcome. Keep your order reference handy if you need help later.' : 'Hi! I can guide you through tickets, payments, account access and travel bookings. What would you like help with?',
            actions: [action('Find my tickets', 'orders'), action('Payment help', 'payment'), action('Service status', 'status')]
        };
        return { text: 'I can help with finding tickets, M-Pesa payments, login and travel bookings. Choose a topic below, or describe what happened. For changes to a booking or a refund, contact support.',
            actions: [action('Find my tickets', 'orders'), action('Payment help', 'payment'), action('Contact support', 'contact')] };
    }
    if (typeof module !== 'undefined' && module.exports) module.exports = { answer };
    else root.TicketsassaSupport = { answer };
})(typeof window === 'undefined' ? this : window);
