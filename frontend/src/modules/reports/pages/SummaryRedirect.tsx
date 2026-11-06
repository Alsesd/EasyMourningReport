import { Navigate, useLocation } from "react-router-dom";

/** `/admin/summary` merged into the month page; keep the period and filter from old links. */
export default function SummaryRedirect() {
  const { search } = useLocation();
  return <Navigate to={`/admin/reports${search}#products`} replace />;
}
