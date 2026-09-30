import { useState } from 'react';
import { ChevronRight, AlertTriangle, BookOpen } from 'lucide-react';
import { Modal, FormRow } from '../ui';
import { COURSE_FEATURES, ALL_FEATURES_ON, COURSE_COLORS, courseColor, courseOfBatch, NO_COURSE } from '../../lib/courses';

// ── Course banner (level 1 of Batches / Students) ─────────────
export function CourseBanner({ course, batchCount, activeCount, studentCount, onClick }) {
  const unlinked = course === null;
  const archived = course?.status === 'archived';
  const color = unlinked ? 'var(--amber)' : courseColor(course);
  return (
    <div onClick={onClick}
      style={{
        background: unlinked ? 'var(--amber-soft)' : 'var(--surface)', borderRadius: 14,
        border: `1px solid ${unlinked ? 'var(--amber)' : 'var(--border)'}`, borderTop: `4px solid ${color}`,
        padding: '18px 20px', cursor: 'pointer', boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
        transition: 'box-shadow 0.2s, transform 0.15s', display: 'flex', flexDirection: 'column', gap: 10,
        opacity: archived ? 0.6 : 1,
      }}
      onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.12)'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
      onMouseLeave={e => { e.currentTarget.style.boxShadow = '0 1px 4px rgba(0,0,0,0.06)'; e.currentTarget.style.transform = 'none'; }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ width: 34, height: 34, borderRadius: 9, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: unlinked ? 'var(--surface)' : 'var(--canvas)' }}>
          {unlinked ? <AlertTriangle size={17} style={{ color: 'var(--amber-ink)' }} /> : <BookOpen size={17} style={{ color }} />}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 16, fontWeight: 700, fontFamily: 'var(--font-display)', color: unlinked ? 'var(--amber-ink)' : 'var(--text)' }}>
              {unlinked ? 'Not linked to a course' : course.name}
            </div>
            {archived && <span className="badge badge-gray">Archived</span>}
          </div>
          <div className="clamp-3" style={{ fontSize: 12.5, color: unlinked ? 'var(--amber-ink)' : 'var(--text-muted)', marginTop: 2 }}>
            {unlinked ? 'Batches created before courses existed.' : (course.description || '')}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12, color: 'var(--text-muted)' }}>
        <span><strong style={{ fontSize: 14, color: 'var(--text)' }}>{batchCount}</strong> batch{batchCount === 1 ? '' : 'es'} ({activeCount} active)</span>
        <span><strong style={{ fontSize: 14, color: 'var(--text)' }}>{studentCount}</strong> student{studentCount === 1 ? '' : 's'}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 6, borderTop: '1px solid var(--border)' }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: unlinked ? 'var(--amber-ink)' : 'var(--brand)', display: 'inline-flex', alignItems: 'center', gap: 2 }}>
          View batches <ChevronRight size={14} />
        </span>
      </div>
    </div>
  );
}

// ── Breadcrumb: All courses › Course name (› extra) ───────────
export function CourseCrumb({ course, onBack, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-muted)', marginBottom: 10, flexWrap: 'wrap' }}>
      <span onClick={onBack} style={{ cursor: 'pointer', color: 'var(--brand)', fontWeight: 600 }}>All courses</span>
      <ChevronRight size={14} />
      <span style={{ color: children ? 'var(--text-muted)' : 'var(--text)', fontWeight: children ? 400 : 600 }}>
        {course ? course.name : 'Not linked to a course'}
      </span>
      {children}
    </div>
  );
}

// ── Course filter dropdown (sits in front of a batch dropdown) ─
// Lists every active course (even one with no batches yet) plus archived
// courses that still have batches, and "Not linked to a course" when some
// batches have none. Renders nothing when there are no courses yet, so pages
// look exactly as before courses existed.
export function CourseSelect({ courses, batches, value, onChange, allLabel = 'All courses', style, className = 'form-input' }) {
  const used = courses.filter(c => c.status !== 'archived' || batches.some(b => b.courseId === c.id));
  const hasUnlinked = batches.some(b => !courseOfBatch(b, courses));
  if (!used.length) return null;
  return (
    <select className={className} style={{ width: 'auto', ...style }} value={value} onChange={e => onChange(e.target.value)} aria-label="Filter by course">
      <option value="">{allLabel}</option>
      {used.map(c => <option key={c.id} value={c.id}>{c.name}{c.status === 'archived' ? ' (archived)' : ''}</option>)}
      {hasUnlinked && <option value={NO_COURSE}>Not linked to a course</option>}
    </select>
  );
}

// ── On/off switch ──────────────────────────────────────────────
function ToggleSwitch({ on, onChange, label }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}
      style={{
        width: 42, height: 24, borderRadius: 12, border: 'none', padding: 2, cursor: 'pointer', flexShrink: 0,
        background: on ? 'var(--brand)' : 'var(--n-300, #D1D5DB)', transition: 'background 0.15s',
        display: 'flex', justifyContent: on ? 'flex-end' : 'flex-start',
      }}>
      <span style={{ width: 20, height: 20, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.25)' }} />
    </button>
  );
}

// ── Radio card (template choice) ───────────────────────────────
function RadioCard({ selected, title, hint, onSelect }) {
  return (
    <div onClick={onSelect} role="radio" aria-checked={selected}
      style={{
        flex: '1 1 180px', padding: '10px 12px', borderRadius: 10, cursor: 'pointer',
        border: `1.5px solid ${selected ? 'var(--brand)' : 'var(--border)'}`,
        background: selected ? 'var(--brand-50)' : 'var(--surface)',
      }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: selected ? 'var(--brand-ink)' : 'var(--text)' }}>
        <span style={{ width: 14, height: 14, borderRadius: '50%', border: `2px solid ${selected ? 'var(--brand)' : 'var(--border)'}`, background: selected ? 'var(--brand)' : 'transparent', boxShadow: selected ? 'inset 0 0 0 2px #fff' : 'none', flexShrink: 0 }} />
        {title}
      </div>
      {hint && <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 4, marginLeft: 22 }}>{hint}</div>}
    </div>
  );
}

// ── Create / edit course ───────────────────────────────────────
// templates: { standardFlow, standardFields, basicFields }
export function CourseFormModal({ initial, templates, saving, onClose, onSave }) {
  const isEdit = !!initial?.id;
  const [form, setForm] = useState(() => ({
    name: initial?.name || '',
    description: initial?.description || '',
    durationMonths: initial?.durationMonths || '',
    color: initial?.color || COURSE_COLORS[0],
    features: { ...ALL_FEATURES_ON, ...(initial?.features || {}) },
    flowTemplate: 'standard',   // 'standard' | 'empty'
    fieldsTemplate: 'standard', // 'standard' | 'basic'
  }));

  const setFeature = (key, on) => setForm(f => ({ ...f, features: { ...f.features, [key]: on } }));

  const submit = (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    const data = {
      name: form.name.trim(),
      description: form.description.trim(),
      durationMonths: form.durationMonths,
      color: form.color,
      features: form.features,
    };
    if (!isEdit) {
      data.courseFlow = (form.features.onboardingFlow && form.flowTemplate === 'standard') ? templates.standardFlow : [];
      data.studentFields = form.fieldsTemplate === 'basic' ? templates.basicFields : templates.standardFields;
    }
    onSave(data);
  };

  return (
    <Modal title={isEdit ? `Edit Course — ${initial.name}` : 'Create Course'} onClose={onClose} wide persistent>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <FormRow>
          <div className="form-group">
            <label className="form-label">Course Name *</label>
            <input className="form-input" required autoFocus placeholder="e.g. ISC Level 1, Music" value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="form-group">
            <label className="form-label">Default Duration (months)</label>
            <input className="form-input" type="number" min="0" placeholder="6" value={form.durationMonths}
              onChange={e => setForm({ ...form, durationMonths: e.target.value })} />
          </div>
        </FormRow>
        <div className="form-group">
          <label className="form-label">Description</label>
          <textarea className="form-input" rows={2} placeholder="What this course is about" value={form.description}
            onChange={e => setForm({ ...form, description: e.target.value })} />
        </div>
        <div className="form-group">
          <label className="form-label">Banner Colour</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {COURSE_COLORS.map(c => (
              <button key={c} type="button" onClick={() => setForm({ ...form, color: c })} aria-label={`Colour ${c}`}
                style={{ width: 28, height: 28, borderRadius: 8, background: c, cursor: 'pointer', border: 'none',
                  boxShadow: form.color === c ? `0 0 0 2px var(--surface), 0 0 0 4px ${c}` : 'none' }} />
            ))}
          </div>
        </div>

        <div>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 2 }}>Features for this course</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
            Switch off what this course doesn't need — those tabs and buttons are hidden for all its batches. You can change this later.
          </div>
          <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
            {COURSE_FEATURES.map((f, i) => (
              <div key={f.key} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderTop: i ? '1px solid var(--border)' : 'none' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{f.label}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{f.hint}</div>
                </div>
                <ToggleSwitch on={form.features[f.key] !== false} label={f.label} onChange={on => setFeature(f.key, on)} />
              </div>
            ))}
          </div>
        </div>

        {!isEdit && (
          <>
            {form.features.onboardingFlow !== false && (
              <div className="form-group">
                <label className="form-label">Course flow for new batches</label>
                <div role="radiogroup" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <RadioCard selected={form.flowTemplate === 'standard'} title="ISC standard steps" hint="Admission, onboarding and course steps used today."
                    onSelect={() => setForm({ ...form, flowTemplate: 'standard' })} />
                  <RadioCard selected={form.flowTemplate === 'empty'} title="Start empty" hint="Add your own steps inside each batch."
                    onSelect={() => setForm({ ...form, flowTemplate: 'empty' })} />
                </div>
              </div>
            )}
            <div className="form-group">
              <label className="form-label">Student details form</label>
              <div role="radiogroup" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <RadioCard selected={form.fieldsTemplate === 'standard'} title="ISC standard form" hint="Parents, school, class, VARK, syllabus and more."
                  onSelect={() => setForm({ ...form, fieldsTemplate: 'standard' })} />
                <RadioCard selected={form.fieldsTemplate === 'basic'} title="Basic form" hint="Name, phone, WhatsApp, email, address."
                  onSelect={() => setForm({ ...form, fieldsTemplate: 'basic' })} />
              </div>
            </div>
          </>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving || !form.name.trim()}>
            {saving ? 'Saving...' : isEdit ? 'Save Changes' : 'Create Course'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
