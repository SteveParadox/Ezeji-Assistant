export function filterConversations(rows, query, status) {
  const search = query.trim().toLocaleLowerCase();
  return rows.filter(row => (status === 'all' || Boolean(row.escalated) === (status === 'escalated')) &&
    (!search || `${row.customer_message || ''} ${row.ai_reply || ''}`.toLocaleLowerCase().includes(search)));
}
export function filterBookings(rows, query, status) {
  const search = query.trim().toLocaleLowerCase();
  return rows.filter(row => (status === 'all' || row.status === status) &&
    (!search || [row.customer_name, row.customer_contact, row.service, row.booking_date].join(' ').toLocaleLowerCase().includes(search)));
}
