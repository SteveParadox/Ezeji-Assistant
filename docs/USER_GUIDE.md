# Business owner and staff user guide

This walkthrough follows the current React workspace (`src/DashboardShell.jsx`, `src/pages/`, `src/gettingStarted.jsx`, `src/AssistantInbox.jsx`). Labels may differ slightly after a future release. **Do not mistake a visible button for a live integration:** activation, payment, booking, and WhatsApp delivery all depend on a properly deployed backend and database.

## 1. Create and verify a business account

1. Open the deployed Ezeji Assistant frontend and select **Start free trial** or the preferred paid plan on the pricing page.
2. Choose **Create account**. Enter **full name, business name, email address and password**. The password must satisfy the form's minimum length requirements.
3. Submit the form once. If email confirmation is required, Ezeji shows a **Check your email** screen rather than immediately treating you as signed in.
4. Open the Supabase confirmation email in the same intended environment. Use the confirmation link before it expires. If needed, use **Resend confirmation**; check spam and ensure you entered the intended email.
5. Sign in. If the authenticated user has no saved business profile, complete the recovery **Business Setup** screen. Do not create a second account to bypass a missing profile.
6. Open **Getting Started**. The selected paid-plan choice is remembered locally for later checkout; **selecting a plan is not payment or entitlement**.

**Expected result:** You reach an owner dashboard associated with your authenticated business. Your business profile and saved plan state are derived from the backend. If setup fails, keep the account and consult [Authentication issues](OPERATIONS_TROUBLESHOOTING.md#authentication-and-onboarding).

## 2. Complete the Getting Started checklist

The checklist is derived from saved records, not just clicks.

1. Choose **Getting Started** from the sidebar. On mobile, open **Dashboard navigation** first.
2. Select **Tell us about your business**. Open **Business Profile** and enter an accurate category, description and relevant public contact details. Save; confirm the success state.
3. Select **Add services and prices**. Enter the first real service name and any known price and duration. Choose **Add item**, then confirm that it appears in the list. Use actual price text; do not enter an invented default.
4. Select **Set business hours and location**. Open **Hours & Location**; mark at least one day **open**, enter its opening and closing times, provide address and city/region, and verify the IANA timezone (for example `Africa/Lagos`). Save.
5. Return to **Getting Started**. Required progress should update using the saved business profile, service count and weekly schedule. If it does not, reopen the page and investigate the save errors.
6. Optionally enter FAQs, configure your assistant, and review Integrations.
7. If you selected a paid plan, continue to the secure checkout button **after** the required checklist steps are complete.

**Important:** A newly provisioned business may start with every day closed and no times configured. Mark the actual open days yourself; Ezeji should not invent business hours.

## 3. Use the workspace navigation

Desktop uses a grouped sidebar. On narrow screens, open the navigation drawer with the menu button and select a page.

| Group | Pages | What they do |
| --- | --- | --- |
| Workspace | Getting Started, Overview | Launch checklist, current activity and AI allowance |
| Assistant | AI Settings, FAQs | Assistant availability, policies/personality, private preview and saved answers |
| Customer Operations | Conversations, Bookings | Saved exchanges, staff handoff state and appointment requests |
| Business Management | Business Profile, Services & Pricing, Hours & Location, Staff | Business facts, catalog, location, operating schedule and invitations |
| Operations | Integrations, Analytics, Billing | Web chat / WhatsApp setup, reporting, invoices and plans |

The active page is reflected in `?view=dashboard&tab=...` for browser refresh/navigation. Staff members see only their permitted pages. **A hidden UI page is not a security boundary; backend authorization is authoritative.**

## 4. Set up and test the assistant

1. Open **AI Settings**.
2. In **Activation and business policies**, inspect the loaded active/paused state and readiness. If required business facts are missing, go back and save them first.
3. Expand **Business policies and language preferences**. Enter truthful booking, cancellation and refund policies, and language preferences where applicable. Select **Save policies**.
4. If your current paid entitlement includes customization, enter a custom assistant name, tone, greeting and escalation topics, then select **Save settings**. Trial/Starter are shown a restricted custom-personality state.
5. In **Assistant preview**, ask test questions such as: “What are your actual hours?”, “What is the price of [saved service]?”, “Can I request a booking?”, or “I want a human.”
6. Check that answers use saved business facts, never invent a guaranteed free slot or payment confirmation, and describe staff review appropriately.
7. Return to the availability section and activate the assistant only after the readiness check passes, credentials are configured and the business is ready to serve customers. If activation is refused, follow the missing-item message rather than bypassing the gate.

**Preview is private to the owner**, uses a separate preview session, and should not create customer bookings/conversations. Provider-backed preview generations may consume AI usage. Turning on an assistant does not automatically make WhatsApp delivery operational.

## 5. Maintain accurate knowledge and contact information

### Services & Pricing

1. Open **Services & Pricing**.
2. Enter the service name, price, and optional duration.
3. Select **Add item** and verify the saved row.
4. To remove an item, click its Delete control, review the confirmation, and confirm. If the database rejects deletion, the item must remain visible.
5. Review any pre-existing bookings before removing a service; deleting catalog data does not erase booking history.

### FAQs

1. Open **FAQs**.
2. Enter both a customer question and its correct answer.
3. Select **Add FAQ** and confirm the new entry is visible.
4. Test the answer in **Assistant preview**.
5. To delete, use the confirmation dialog. Canceling must retain unfinished draft text.

### Business Profile and Hours

1. Change name, category, description and public contact details in **Business Profile**.
2. For opening/closing times, use **Hours & Location**, **not** a free-text summary. Set open days, time ranges, address, city and timezone.
3. Save and verify after each change. A stale “Saved” message should not be treated as proof for unsaved subsequent edits.
4. Retest assistant answers after any price, policy or hours change.

## 6. Publish and test a customer web chat link

1. Open **Integrations** or the customer link in **Getting Started**.
2. Select **Open customer chat**. The URL contains `?view=chat&biz=<business UUID>`.
3. In a separate browser/private window, test it as a customer. Ask about verified services/hours and a normal booking request.
4. Confirm the public chat does not show an unrelated signed-in owner's private business data.
5. Test the staff-review wording and any booking review/confirmation prompts before publishing the link.
6. Only then share the link. An accessible link does **not** guarantee AI readiness, quota availability, backend health or Meta connectivity.

Customer and preview sessions are distinct. Clearing chat content does not imply deleting previously created bookings, billing records or separate retention obligations.

## 7. Review conversations and hand off to staff

1. Open **Conversations** to view saved exchanges. Search recent messages and filter by escalation as needed.
2. Use the **Live conversation records** section to select a customer session and inspect its channel and history.
3. When human review is required, choose **Pause automation for staff**. Automated replies are paused for that thread as the backend allows.
4. Follow up through the business's supported customer contact method. **This dashboard does not itself send an outbound staff reply.**
5. Use **Mark resolved** to record resolution, or **Return to assistant** when the issue is suitable for automation again.
6. For WhatsApp, respect customer STOP/START opt-out controls. Never reactivate an opted-out sender contrary to policy.

Do not interpret “not escalated” as “resolved”; it only means no escalation flag has been recorded.

## 8. Review and confirm booking requests

1. Open **Bookings** (available to eligible paid owners or authorized staff).
2. Use search and the status filter to find a request.
3. Check the date/time, service, customer information and actual staff/resource availability.
4. Click **Confirm**, read the confirmation dialog and approve only when you can fulfill the appointment.
5. Check that the saved row changes to **confirmed**. If an error appears, do not tell the customer it is confirmed.
6. To cancel a pending or confirmed booking, use its Cancel control and verify the stored status.
7. Use **Export CSV** for an authorized local copy when necessary. Handle exported customer data securely.

A `pending` request is never a guaranteed appointment. Booking capacity, blackout periods and operational policies must be evaluated outside optimistic UI assumptions.

## 9. Invite and manage staff

1. Open **Staff** from the owner workspace (requires an eligible active plan).
2. Review seats allowed by your plan.
3. Enter the invitee's email and choose **Invite staff**.
4. If the server reports **Invitation email sent**, ask the invitee to check their inbox. Otherwise, privately deliver the secure invitation link as instructed.
5. Have the invitee accept with a verified account and select their assigned business if they belong to multiple teams.
6. Check their staff view: owner billing/settings should not be exposed.
7. To revoke access, choose Remove for the correct person and confirm. Recheck access after removal.

Invitation links and customer data must not be posted publicly.

## 10. Connect WhatsApp (eligible plans and configured deployments)

1. Confirm the operator has deployed the HTTPS Meta webhook and running WhatsApp worker according to the [deployment guide](DEPLOYMENT_RUNBOOK.md).
2. In **Integrations**, enter the Meta **Phone Number ID** and current access token.
3. Select **Connect WhatsApp** or **Update connection**; the backend verifies and encrypts credentials.
4. Check the displayed configuration state and, if returned, verified display number. This still does **not** prove inbound/outbound webhook delivery.
5. Complete callback URL, verification token and webhook subscription in Meta's dashboard (server-side secret never entered in frontend).
6. Send a controlled test from a permitted phone. Confirm inbound event, worker processing, reply and provider delivery evidence.
7. If rotating a token, update it and verify again. To disconnect, choose **Disconnect**, confirm, then verify disabled behavior.

## 11. Pay for or renew a plan safely

1. Open **Billing** and review the current plan, paid term and invoices.
2. Choose **Starter**, **Professional**, or **Business**, and **Monthly** or **Yearly**. Prices are displayed in NGN and must match the server's catalog.
3. Select **Continue to Paystack** and finish a **one-time** payment on the provider's site.
4. On return, wait for or explicitly refresh **Checking your payment**. The app uses your specific transaction reference for authenticated verification.
5. Only trust **paid/active** status after backend provider verification, committed invoice, and matching entitlement. Pending/failed/review-required means no new entitlement should be assumed.
6. If the browser was closed or the webhook was missed, use the payment verification/recovery flow. **Do not immediately pay again** without checking whether the first charge settled.
7. Paid access does not automatically renew. Review end date and cancellation-at-end-of-term controls as applicable.

**Never share Paystack reference details with someone claiming to “activate” the plan manually.** Use the business's verified support process.

## 12. Review analytics, quota and billing records

1. **Overview:** inspect conversation counts and current AI usage, with unavailable states when backend data cannot be read.
2. **Analytics:** select a 7/30/90-day view, where available. Reporting distinguishes messages, escalation, booking intent and assistant session metrics.
3. **Billing:** inspect invoice history and subscription expiration. Invoices should come from verified settlement, not frontend-generated records.
4. When AI usage reaches its allowance or entitlement expires, follow the visible notice and restore a valid entitlement through normal billing; never modify browser storage to bypass access checks.

## 13. Password reset, logout and support

- To reset a password: choose **Forgot password?**, request the email, open its configured recovery link, enter and confirm the new password, then sign in with it.
- If you used a shared device: select **Log out**; do not leave exports or saved credentials behind.
- On errors: note the screen, exact steps, timestamp, visible request ID (if shown), sanitized browser console/network outcome and whether the issue reproduces after a reload.
- For operator escalation, see [Operations and troubleshooting](OPERATIONS_TROUBLESHOOTING.md). Never send service-role keys, Meta tokens, full customer conversation contents or payment secrets to general support channels.
