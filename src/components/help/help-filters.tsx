/**
 * SOCIO's precise-filter shape. The top-right Filters control that used to
 * write these into the URL has been removed — SOCIO now always renders the
 * full, unfiltered feed. The type (and the server-side query args it feeds in
 * `campus-help-shell.tsx`) is kept only so a direct `?category=`-style deep
 * link still narrows the query; there is no UI to set it anymore.
 */
export type SocioFilters = {
  category: string;
  department: string;
  semester: string;
  course: string;
  q: string;
};
