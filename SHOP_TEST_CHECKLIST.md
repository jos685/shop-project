# SalesTrack Shop POS — Beta Tester Checklist

**Version:** 1.0  
**Date:** 2026-05-30  
**Tester Name:** ___________________________  
**Device / Browser / OS:** ___________________________  
**Test Environment URL:** ___________________________  
**Shop Name:** ___________________________

---

## How to Use This Checklist

For each item, mark the result column:
- **PASS** — Feature works exactly as described
- **FAIL** — Feature does not work or behaves unexpectedly
- **N/A** — Not applicable (e.g. feature not enabled on your test account)

Write any notes, error messages, or screenshots in the **Notes** column.

---

---

## SECTION 1 — AUTHENTICATION & LOGIN

### 1.1 Terminal Login

| # | Action to Test | Expected Result | Result | Notes |
|---|----------------|-----------------|--------|-------|
| 1 | Visit the shop POS login page | Page loads with Business Code, Shop ID, and Password fields | | |
| 2 | Submit with all fields empty | Validation errors on all required fields | | |
| 3 | Enter a Shop ID suffix longer than 4 digits | Input limited to 4 digits | | |
| 4 | Enter a wrong password | Error message displayed | | |
| 5 | Enter correct Business Code, Shop ID, and Password | Login succeeds; redirected to POS dashboard | | |
| 6 | Fail login 5 times in a row | Account locked for 30 seconds; countdown timer shown | | |
| 7 | Wait for the 30-second lockout to expire | Can attempt login again | | |
| 8 | Toggle dark/light theme on login page | Theme switches; preference saved | | |

### 1.2 Offline Login

| # | Action to Test | Expected Result | Result | Notes |
|---|----------------|-----------------|--------|-------|
| 9 | Log in online at least once, then go offline | Offline banner appears | | |
| 10 | Enter correct credentials while offline | Login succeeds using cached credentials | | |
| 11 | Enter wrong credentials while offline | Login fails with error | | |

### 1.3 Session & Inactivity

| # | Action to Test | Expected Result | Result | Notes |
|---|----------------|-----------------|--------|-------|
| 12 | Leave the POS terminal idle for 30 minutes | Auto-logout occurs; redirected to login page | | |
| 13 | Use the terminal actively (tap/click/type) | Inactivity timer resets; session stays alive | | |

### 1.4 Logout

| # | Action to Test | Expected Result | Result | Notes |
|---|----------------|-----------------|--------|-------|
| 14 | Click the Logout button in top navigation | Confirmation modal appears | | |
| 15 | Confirm logout | Session cleared; redirected to login | | |
| 16 | Close the browser tab after logout | Shop shows as "Offline" on owner dashboard | | |
| 17 | Press browser back after logging out | Cannot navigate back to protected pages | | |

---

## SECTION 2 — DASHBOARD

### 2.1 Today's Summary Cards

| # | Action to Test | Expected Result | Result | Notes |
|---|----------------|-----------------|--------|-------|
| 18 | View the dashboard after login | Page loads with all summary cards | | |
| 19 | Check "Transaction Count" card | Shows number of sales today | | |
| 20 | Check "Net Revenue" card | Shows revenue minus returns and expenses (KSh X,XXX) | | |
| 21 | Check "Cash" card | Shows total cash collected today | | |
| 22 | Check "M-Pesa" card | Shows total M-Pesa received today | | |

### 2.2 Hourly Sales Chart

| # | Action to Test | Expected Result | Result | Notes |
|---|----------------|-----------------|--------|-------|
| 23 | View hourly sales activity chart | Chart covers 6 AM – 8 PM; current hour highlighted | | |
| 24 | Hover / tap a chart point | Tooltip shows transaction count and revenue for that hour | | |

### 2.3 Stock Alerts Section

| # | Action to Test | Expected Result | Result | Notes |
|---|----------------|-----------------|--------|-------|
| 25 | View "My Stock" section | Top 7 low-stock products listed | | |
| 26 | Check color coding | <10% remaining = red, <30% = yellow, healthy = green | | |
| 27 | Check alert pill in top nav | Shows count of low-stock + pending requests | | |
| 28 | Tap alert pill | Navigates to Stock Info or Requests page | | |

### 2.4 Recent Transactions

| # | Action to Test | Expected Result | Result | Notes |
|---|----------------|-----------------|--------|-------|
| 29 | View recent transactions section | Last 8 today's sales shown with product, seller, amount, time | | |
| 30 | Queued offline sales shown in recent list | Offline sales marked with ⏳ pending indicator | | |

### 2.5 Payment Split Card

| # | Action to Test | Expected Result | Result | Notes |
|---|----------------|-----------------|--------|-------|
| 31 | View payment split card (when revenue > 0) | Breakdown by Cash / M-Pesa with percentages and bar | | |
| 32 | Check payment split card when no sales today | Card hidden or shows zeros | | |

### 2.6 Quick Navigation

| # | Action to Test | Expected Result | Result | Notes |
|---|----------------|-----------------|--------|-------|
| 33 | Tap the large "Scan & Sell" hero button | Navigates to Scan & Sell page | | |
| 34 | Tap the Transactions card | Navigates to Transactions page | | |
| 35 | Tap the Stock card | Navigates to Shop Info → Stock tab | | |

### 2.7 Queued Sales Card

| # | Action to Test | Expected Result | Result | Notes |
|---|----------------|-----------------|--------|-------|
| 36 | Go offline; make a sale | Queued Sales card appears on dashboard with total | | |
| 37 | Reconnect internet | Card disappears after sync completes | | |

### 2.8 Live Clock

| # | Action to Test | Expected Result | Result | Notes |
|---|----------------|-----------------|--------|-------|
| 38 | View clock in top navigation (desktop) | Clock shows correct Kenya time (EAT); updates every second | | |

### 2.9 Heartbeat / Online Status

| # | Action to Test | Expected Result | Result | Notes |
|---|----------------|-----------------|--------|-------|
| 39 | Log into POS terminal | Owner dashboard shows shop as "Online" within 60 seconds | | |
| 40 | Log out of terminal | Owner dashboard shows shop as "Offline" | | |

---

## SECTION 3 — SCAN & SELL

### 3.1 Scan Mode

| # | Action to Test | Expected Result | Result | Notes |
|---|----------------|-----------------|--------|-------|
| 41 | Navigate to Scan & Sell page | Scanner loads; camera scan option visible | | |
| 42 | Switch to Camera Scan mode | Camera activates; QR/barcode scanner ready | | |
| 43 | Scan a valid product QR code | Product added to cart; confirmation shown | | |
| 44 | Scan an unrecognized QR code | "SKU not found" feedback shown | | |
| 45 | Scan a product with zero remaining stock | Error: "no stock available" shown | | |
| 46 | Switch to Manual Lookup mode | Product list and SKU search field appear | | |
| 47 | Type a valid SKU in the lookup field | Product found; can be added to cart | | |
| 48 | Type a non-existent SKU | "Not found" error shown | | |
| 49 | Search product list by name | Real-time filtering of product list | | |
| 50 | Click a product from the manual list | Product added to cart with qty = 1 | | |
| 51 | Tap a product already in cart | Quantity increments; no duplicate entry | | |
| 52 | View Cart button in header | Shows item count + grand total while on scan step | | |

### 3.2 Checkout — Cart Review

| # | Action to Test | Expected Result | Result | Notes |
|---|----------------|-----------------|--------|-------|
| 53 | Tap "View Cart" / proceed to checkout | Cart review screen loads | | |
| 54 | Increase item quantity using + button | Quantity increases; total updates | | |
| 55 | Try to increase beyond available remaining stock | Blocked at max; + button disabled | | |
| 56 | Decrease item quantity using − button (qty > 1) | Quantity decreases | | |
| 57 | Tap − button when quantity = 1 | Item removed from cart | | |
| 58 | View grand total | Correct sum of all items (qty × sell price) | | |
| 59 | View commission earnings strip (if enabled) | Commission rate % and earned KSh amount shown | | |
| 60 | Edit sell price on an item (if commission enabled) | Sell price field editable; commission updates | | |
| 61 | Try to set sell price below base price | Validation error: cannot go below base price | | |

### 3.3 Checkout — Customer & Payment

| # | Action to Test | Expected Result | Result | Notes |
|---|----------------|-----------------|--------|-------|
| 62 | Enter customer name (optional for cash/M-Pesa) | Accepted; saved for future use | | |
| 63 | Enter customer name shorter than 2 characters | Validation error | | |
| 64 | Enter customer phone in wrong format | Validation error on phone field | | |
| 65 | Enter valid Kenyan phone (07XX or 01XX or +254XX) | Accepted; no error | | |
| 66 | Search for a saved customer by name | Matching names shown in dropdown | | |
| 67 | Search for a saved customer by phone | Matching customer found | | |
| 68 | Select a saved customer | Name and phone auto-filled | | |
| 69 | Select "Cash" payment method | No additional fields needed | | |
| 70 | Select "M-Pesa" payment method | M-Pesa reference field appears (8–12 chars) | | |
| 71 | Enter M-Pesa ref shorter than 8 chars | Validation error | | |
| 72 | Select "Split" payment method | Cash + M-Pesa amount fields appear | | |
| 73 | Enter split amounts that equal grand total | Validation passes | | |
| 74 | Enter split amounts off by more than KSh 1 | Validation error: amounts must balance | | |
| 75 | Select "Credit (Pay Later)" payment method | Customer name and phone become required fields | | |
| 76 | Submit Credit sale without customer name | Validation error | | |
| 77 | Submit Credit sale without customer phone | Validation error | | |
| 78 | Enter optional upfront payment on credit sale (amount > 0) | Accepted; initial payment recorded | | |
| 79 | Enter upfront payment = 0 | Allowed; full amount becomes credit | | |
| 80 | Enter upfront payment > total | Validation error | | |
| 81 | Tap "Review Cart" with empty cart | Blocked; must have at least 1 item | | |

### 3.4 Agent PIN Verification

| # | Action to Test | Expected Result | Result | Notes |
|---|----------------|-----------------|--------|-------|
| 82 | After cart review, verification step appears | PIN entry screen loads | | |
| 83 | Toggle to PIN mode | 4-digit keypad shown | | |
| 84 | Enter correct agent PIN | Sale proceeds immediately after correct PIN | | |
| 85 | Enter wrong PIN 1–2 times | Error shown; remaining attempts not yet displayed | | |
| 86 | Enter wrong PIN 3+ times | "X attempts remaining" shown | | |
| 87 | Fail PIN 5 times | 30-second lockout with countdown | | |
| 88 | Wait for lockout to expire | Can try PIN again | | |
| 89 | Toggle to Badge Scan mode | QR scanner activates for agent badge | | |
| 90 | Scan a valid agent badge QR code | Sale proceeds with that agent as seller | | |
| 91 | Scan an invalid/unrecognized badge | Error: agent not recognized | | |
| 92 | Scan badge of an agent not assigned to this shop | Error: agent not in this shop | | |

### 3.5 Success Screen

| # | Action to Test | Expected Result | Result | Notes |
|---|----------------|-----------------|--------|-------|
| 93 | Complete a Cash sale | Success screen shows Batch ID, timestamp, seller, total | | |
| 94 | Complete an M-Pesa sale | M-Pesa reference shown on success screen | | |
| 95 | Complete a Split sale | Both cash and M-Pesa amounts shown | | |
| 96 | Complete a Credit sale | Credit Sale ID shown; credit status indicated | | |
| 97 | Complete sale with customer phone provided | Receipt status shows "Sent" or "Failed" | | |
| 98 | Tap "+ New Sale" | Scanner resets; cart cleared; ready for next sale | | |
| 99 | View offline queued sale success | "QUEUED — will sync when online" message shown | | |

---

## SECTION 4 — TRANSACTIONS

### 4.1 View Transactions

| # | Action to Test | Expected Result | Result | Notes |
|---|----------------|-----------------|--------|-------|
| 100 | Navigate to Transactions page | Full list of transactions shown, most recent first | | |
| 101 | View summary cards | Net Total, Cash, M-Pesa amounts shown | | |
| 102 | Check Returns Deducted card (if returns exist) | Total refunded amount shown | | |
| 103 | Check Commission Clawed Back card (if applicable) | Commission reductions from returns shown | | |
| 104 | View Queued card (if offline items pending) | Pending sync total shown | | |
| 105 | Expand a transaction row | Full details: product, qty, seller, payment breakdown, customer, time | | |
| 106 | View queued offline sale | Items listed; status shows "Pending sync" | | |

### 4.2 Filters

| # | Action to Test | Expected Result | Result | Notes |
|---|----------------|-----------------|--------|-------|
| 107 | Filter by "Sales" type | Only sale transactions shown | | |
| 108 | Filter by "Expenses" type | Only expenses shown | | |
| 109 | Filter by "Returns" type | Only returned transactions shown | | |
| 110 | Filter by "All" type | All transaction types shown | | |
| 111 | Filter date: Today | Only today's transactions | | |
| 112 | Filter date: This Week | This week's transactions | | |
| 113 | Filter date: This Month | This month's transactions | | |
| 114 | Filter date: All Time | All historical transactions | | |
| 115 | Filter date: Custom — select specific day | Date picker appears; data filtered to that day | | |
| 116 | Filter date: Custom — select specific month | Month picker; data for that month | | |
| 117 | Filter date: Custom — select specific year | Year dropdown; data for that year | | |
| 118 | Filter payment method: Cash | Only cash transactions | | |
| 119 | Filter payment method: M-Pesa | Only M-Pesa transactions | | |
| 120 | Filter payment method: Split | Only split transactions | | |

### 4.3 Search

| # | Action to Test | Expected Result | Result | Notes |
|---|----------------|-----------------|--------|-------|
| 121 | Search by product name | Matching transactions shown | | |
| 122 | Search by seller name | Transactions by that agent shown | | |
| 123 | Search by customer phone | Matching transaction found | | |
| 124 | Search by M-Pesa reference | Matching transaction found | | |
| 125 | Search by SKU | Product transactions shown | | |
| 126 | Search with no match | Empty state shown | | |

### 4.4 Returns

| # | Action to Test | Expected Result | Result | Notes |
|---|----------------|-----------------|--------|-------|
| 127 | Expand a transaction; tap "Return Items" | Return modal opens | | |
| 128 | Select a quantity to return (partial) | Partial return processed; "Partial" status badge shown | | |
| 129 | Return all units | "Fully Returned" status shown | | |
| 130 | Enter empty return reason | Validation error: reason required | | |
| 131 | Complete a return | Stock restored; transaction status updates | | |
| 132 | Try to return more units than originally sold | Blocked at original quantity | | |
| 133 | View return status badge on transaction row | "None" / "Partial" / "Full" badge | | |
| 134 | Return requires agent PIN verification | PIN entry prompt appears before return is processed | | |

### 4.5 Receipt Actions

| # | Action to Test | Expected Result | Result | Notes |
|---|----------------|-----------------|--------|-------|
| 135 | View a transaction with sent receipt | "Receipt Sent" badge shown | | |
| 136 | View a transaction with failed receipt | "Receipt Failed" badge; option to resend | | |
| 137 | Tap "Resend Receipt" | Confirmation modal; SMS sent; status updates | | |
| 138 | Tap "Resend" and change phone number | New phone number used for SMS | | |

### 4.6 Pagination

| # | Action to Test | Expected Result | Result | Notes |
|---|----------------|-----------------|--------|-------|
| 139 | Scroll to bottom of transaction list | "Load More" button appears | | |
| 140 | Tap "Load More" | Next 25 transactions load | | |

---

## SECTION 5 — SHOP INFO

### 5.1 Stock Tab

| # | Action to Test | Expected Result | Result | Notes |
|---|----------------|-----------------|--------|-------|
| 141 | Navigate to Shop Info → Stock tab | Stock list loads with all allocated products | | |
| 142 | View stock summary cards | Product count, stock value, allocated value shown | | |
| 143 | Check color-coded stock bars | Red = out/critical, Yellow = low, Green = healthy | | |
| 144 | Check out-of-stock product | Red warning box: "Out of stock — contact supervisor" | | |
| 145 | Check a product at <20% remaining | Yellow bar shown | | |
| 146 | Check a product at good stock level | Green bar shown | | |
| 147 | Expand a product row (mobile) | Unit price, allocated, sold, stock bar shown | | |
| 148 | View desktop stock table | Columns: Product, Unit Price, Allocated, Remaining, Sold | | |
| 149 | Tap the Refresh button | Stock data reloads from server | | |

### 5.2 Agents Tab

| # | Action to Test | Expected Result | Result | Notes |
|---|----------------|-----------------|--------|-------|
| 150 | Navigate to Shop Info → Agents tab | Grid of assigned agents shown | | |
| 151 | View each agent card | Name, agent code, initials avatar, "Active" badge | | |
| 152 | Check if agents not assigned to this shop appear | They should NOT appear | | |
| 153 | View when no agents are assigned | Placeholder/empty state shown | | |

---

## SECTION 6 — ACTIVITY HUB (REQUESTS)

### 6.1 Create a Request

| # | Action to Test | Expected Result | Result | Notes |
|---|----------------|-----------------|--------|-------|
| 154 | Navigate to Activity Hub / Requests tab | Requests list and "New Request" button shown | | |
| 155 | Tap "Create New Request" | Modal slides up with 4 request type cards | | |
| 156 | Select "Stock Request" type | Product dropdown and quantity field appear | | |
| 157 | Select "Damage / Loss" type | Product and quantity fields appear | | |
| 158 | Select "Customer Demand" type | Product field appears; quantity optional | | |
| 159 | Select "Message" type | Only message field required | | |
| 160 | Submit without selecting a product (Stock Request) | Validation error: product required | | |
| 161 | Submit with quantity = 0 | Validation error: minimum 1 | | |
| 162 | Submit with quantity > 9999 | Validation error: maximum 9999 | | |
| 163 | Submit with empty message | Validation error: message required | | |
| 164 | Enter message longer than 500 characters | Character limit enforced or validation error | | |
| 165 | Submit a valid Stock Request | Request sent; appears in list as "Pending" | | |
| 166 | Submit a valid Damage Report | Request created with damage type | | |
| 167 | Submit a Customer Demand request | Request created with demand type | | |
| 168 | Submit a General Message | Request created with message type | | |
| 169 | Submit a request while offline | Queued; shows as "QUEUED" in list | | |

### 6.2 View & Track Requests

| # | Action to Test | Expected Result | Result | Notes |
|---|----------------|-----------------|--------|-------|
| 170 | View requests list | Requests shown with type icon, status badge, time | | |
| 171 | Tap a pending request | Expands to show full message, product, qty | | |
| 172 | Owner approves a request | Status changes to "Approved" (green badge) | | |
| 173 | Expand an approved request | Owner's reply shown in green reply box | | |
| 174 | Owner rejects a request | Status changes to "Rejected" (red badge) | | |
| 175 | Expand a rejected request | Rejection reason shown in red reply box | | |
| 176 | View queued offline requests | Yellow "QUEUED" card shown at top | | |

---

## SECTION 7 — EXPENSES

### 7.1 Log an Expense

| # | Action to Test | Expected Result | Result | Notes |
|---|----------------|-----------------|--------|-------|
| 177 | Navigate to Activity Hub → Expenses tab | Expense list and "Log Expense" button shown | | |
| 178 | Tap "Log Expense" | Form modal opens | | |
| 179 | Select agent from dropdown | Active agents listed; select one | | |
| 180 | Enter agent's PIN for verification | 4-digit keypad; correct PIN confirms identity | | |
| 181 | Enter wrong PIN 5 times | 30-second lockout | | |
| 182 | Submit with amount = 0 | Validation error | | |
| 183 | Submit with no description | Validation error: description required | | |
| 184 | Submit valid amount, description, and payment method | Expense saved; appears in list | | |
| 185 | Log expense with Cash method | Saved with cash method | | |
| 186 | Log expense with M-Pesa method | Saved with M-Pesa method | | |
| 187 | Log expense with Split method | Saved with split method | | |
| 188 | Edit an existing expense | Edit modal opens; same agent PIN required | | |
| 189 | Change expense amount and save | Updated correctly | | |
| 190 | Log expense while offline | Queued until reconnection | | |

### 7.2 View Expenses

| # | Action to Test | Expected Result | Result | Notes |
|---|----------------|-----------------|--------|-------|
| 191 | View expense list | Description, logged-by agent, amount, time shown | | |
| 192 | View queued offline expense | Shown as pending in list | | |

---

## SECTION 8 — CREDIT SALES

### 8.1 View Credits

| # | Action to Test | Expected Result | Result | Notes |
|---|----------------|-----------------|--------|-------|
| 193 | Navigate to Activity Hub → Credit tab | Credit summary and customer list shown | | |
| 194 | View summary cards | Total Credit, Collected, Outstanding amounts | | |
| 195 | View customers list | Grouped by customer; sorted by outstanding balance (highest first) | | |
| 196 | Check status badges | Pending (red), Partial (yellow), Paid (green), Returned (grey) | | |
| 197 | Expand a customer group | All credit sales for that customer listed | | |
| 198 | Expand a credit sale | Line items (product, qty, unit price, subtotal) shown | | |
| 199 | View payment history within credit sale | Chronological list of payments | | |

### 8.2 Record a Payment

| # | Action to Test | Expected Result | Result | Notes |
|---|----------------|-----------------|--------|-------|
| 200 | Tap "Record Payment" on a credit sale | Payment modal opens | | |
| 201 | Enter amount > outstanding balance | Validation error | | |
| 202 | Enter amount = 0 | Validation error | | |
| 203 | Select Cash and submit valid amount | Payment recorded; balance decreases | | |
| 204 | Select M-Pesa and enter valid reference | Payment recorded with reference | | |
| 205 | Make full payment | Credit sale status changes to "Paid" (green) | | |
| 206 | Payment requires agent + PIN verification | Agent selector and PIN prompt appear | | |
| 207 | Enter wrong PIN when recording payment | Error; remaining attempts shown | | |
| 208 | View updated payment history after recording | New entry appears in payment list | | |
| 209 | View updated outstanding balance | Correctly reduced after payment | | |

### 8.3 Mark as Returned

| # | Action to Test | Expected Result | Result | Notes |
|---|----------------|-----------------|--------|-------|
| 210 | Tap "Mark as Returned" on a credit sale | Confirmation prompt shown | | |
| 211 | Confirm the return | Credit sale status → "Returned"; stock restored | | |
| 212 | Verify stock restored in Shop Info | Returned units appear back in remaining stock | | |
| 213 | Return requires agent + PIN verification | PIN prompt appears | | |

### 8.4 Credit Statement SMS

| # | Action to Test | Expected Result | Result | Notes |
|---|----------------|-----------------|--------|-------|
| 214 | Tap "Send Credit Statement" on a customer group | SMS sent with full itemized balance to customer | | |
| 215 | Edit phone before sending | Correct phone used | | |
| 216 | Send to customer with no phone on file | Prompt to enter phone appears | | |

---

## SECTION 9 — NAVIGATION & UI

### 9.1 Bottom Navigation

| # | Action to Test | Expected Result | Result | Notes |
|---|----------------|-----------------|--------|-------|
| 217 | Tap Dashboard tab | Dashboard loads | | |
| 218 | Tap Transactions tab | Transactions page loads | | |
| 219 | Tap Scan & Sell (center button) | Scanner page loads | | |
| 220 | Tap Shop Info tab | Shop Info → Stock loads | | |
| 221 | Tap Activity Hub tab | Requests / Expenses / Credits loads | | |

### 9.2 Top Navigation

| # | Action to Test | Expected Result | Result | Notes |
|---|----------------|-----------------|--------|-------|
| 222 | View alert pill | Shows combined low-stock + pending request count | | |
| 223 | Tap alert pill | Navigates to appropriate page | | |
| 224 | Toggle dark/light theme | UI switches; preference saved | | |
| 225 | Tap Tour / onboarding button | Shop onboarding tour starts | | |
| 226 | Tap Refresh button | Page data reloads | | |

### 9.3 Onboarding Tour

| # | Action to Test | Expected Result | Result | Notes |
|---|----------------|-----------------|--------|-------|
| 227 | First login on a fresh terminal | Onboarding tour auto-starts | | |
| 228 | Step through the tour | Each step highlights a POS feature with tooltip | | |
| 229 | Skip or complete the tour | Dismissed; can replay via tour button | | |

---

## SECTION 10 — OFFLINE CAPABILITIES

| # | Action to Test | Expected Result | Result | Notes |
|---|----------------|-----------------|--------|-------|
| 230 | Disconnect internet while using POS | Offline banner appears | | |
| 231 | Build cart and complete sale while offline | Sale queued; QUEUED badge shown | | |
| 232 | Log expense while offline | Queued until reconnection (no PIN check needed when offline) | | |
| 233 | Submit a request while offline | Queued until reconnection | | |
| 234 | View stock while offline | Cached stock data shown | | |
| 235 | View cached agents while offline | Cached agent list shown | | |
| 236 | Reconnect internet | All queued sales sync automatically; toast notification shown | | |
| 237 | Verify synced sales in Transactions | Correct data, no duplicates | | |
| 238 | Check stock after sync | Remaining counts updated for synced sales | | |
| 239 | Queued sale stock deduction reflected immediately | Remaining count decreases before sync completes | | |

---

## SECTION 11 — SECURITY & PIN SYSTEM

| # | Action to Test | Expected Result | Result | Notes |
|---|----------------|-----------------|--------|-------|
| 240 | Enter correct agent PIN during sale | Sale proceeds; correct seller attributed | | |
| 241 | Enter wrong PIN 5 times | 30-second lockout with countdown | | |
| 242 | Wait for PIN lockout to expire | Can try again after countdown | | |
| 243 | Use agent badge scan instead of PIN | Badge scan accepted; sale attributed to that agent | | |
| 244 | Scan badge of agent not assigned to this shop | Error: agent not recognized for this shop | | |
| 245 | PIN required for expense logging | Cannot log expense without correct agent PIN | | |
| 246 | PIN required for credit payment | Cannot record payment without correct agent PIN | | |
| 247 | PIN required for credit return | Cannot process return without correct agent PIN | | |

---

## SECTION 12 — RESPONSIVENESS & LAYOUT

| # | Action to Test | Expected Result | Result | Notes |
|---|----------------|-----------------|--------|-------|
| 248 | Use POS on a tablet (768px width) | Layout adapts; all features accessible | | |
| 249 | Use POS on a phone (375px width) | Single-column layout; bottom nav visible | | |
| 250 | Use POS on a desktop/laptop | Full widescreen layout; clock visible in top nav | | |
| 251 | Open a modal on mobile | Modal fits screen; can scroll if needed | | |
| 252 | Check bottom nav on narrow screen (<400px) | Nav buttons still readable and tappable | | |

---

## SECTION 13 — DATA ACCURACY CHECKS

| # | Action to Test | Expected Result | Result | Notes |
|---|----------------|-----------------|--------|-------|
| 253 | Make 3 sales totalling KSh 2,000; check Net Revenue on dashboard | Shows KSh 2,000 | | |
| 254 | Sell 4 units of a product; check Shop Info stock | Remaining decreases by 4 | | |
| 255 | Make a sale; check owner dashboard | Owner sees the sale within 60 seconds | | |
| 256 | Return 2 of 4 sold units | Remaining stock increases by 2 | | |
| 257 | Log expense of KSh 300; check Net Revenue | Net Revenue reduced by KSh 300 | | |
| 258 | Make a split sale KSh 400 cash + KSh 600 M-Pesa | Dashboard shows correct Cash and M-Pesa totals | | |
| 259 | Credit sale KSh 1,000; record payment KSh 400 | Outstanding balance = KSh 600 | | |
| 260 | Record full payment on credit sale | Status changes to "Paid" | | |
| 261 | Complete sale; check seller attribution in owner dashboard | Owner sees the correct agent's name as seller | | |
| 262 | Commission: agent sells at markup; check commission tab in agent app | Commission correctly calculated and shown | | |

---

## TESTER SIGN-OFF

| Field | Value |
|-------|-------|
| **Tester Name** | |
| **Test Date** | |
| **Total Items Tested** | |
| **PASS Count** | |
| **FAIL Count** | |
| **N/A Count** | |
| **Critical Issues Found** | |
| **General Notes** | |

---

*Thank you for helping us improve SalesTrack! Please send this completed checklist with any screenshots of failures to the development team.*
