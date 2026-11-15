// CR-169 · lát 6 · mục có tiêu đề của danh sách hội thoại (dùng chung `DirectorySections`, `PeopleSearch`).

export function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section aria-label={label}>
      <h3 className="m-0 px-4 pb-1 pt-3 text-micro font-semibold uppercase tracking-wide text-dim">
        {label}
      </h3>
      {children}
    </section>
  );
}
