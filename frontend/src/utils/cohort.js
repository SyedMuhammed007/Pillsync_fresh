/**
 * Cohort management helper for PillSync.
 * Determines patient assignment to caregivers and retrieves the active cohort.
 */

export function isPatientAssignedToCaregiver(patient, caregiverUser) {
  if (!caregiverUser) return false;
  const role = (caregiverUser.role || '').toLowerCase();
  if (role === 'admin') return true;
  if (!patient) return false;

  const assigned = String(patient.assignedCaregiver || '').trim().toLowerCase();
  if (!assigned || assigned === 'unassigned') return false;

  const cName = caregiverUser.name ? String(caregiverUser.name).trim().toLowerCase() : '';
  const cEmail = caregiverUser.email ? String(caregiverUser.email).trim().toLowerCase() : '';
  const cUserPart = cEmail ? cEmail.split('@')[0] : '';

  // 1. Direct match with caregiver's name, email, or username part
  if (
    (cName && assigned === cName) ||
    (cEmail && assigned === cEmail) ||
    (cUserPart && assigned === cUserPart) ||
    (cName && (assigned.includes(cName) || cName.includes(assigned))) ||
    (cUserPart && (assigned.includes(cUserPart) || cUserPart.includes(assigned)))
  ) {
    return true;
  }

  // 2. Shared clinical care cohort available to all registered clinical caregivers
  if (
    assigned === 'caregiver clinician' ||
    assigned === 'clinical caregiver' ||
    assigned === 'clinical oversight' ||
    assigned === 'all caregivers'
  ) {
    return true;
  }

  return false;
}

export function getAllMergedPatients() {
  let allPatients = [];

  // 1. Registered users is the primary source of truth synced from the central database
  let registeredPatients = [];
  try {
    const rawUsers = localStorage.getItem('pillsync_registered_users');
    if (rawUsers) {
      const users = JSON.parse(rawUsers);
      if (Array.isArray(users)) {
        registeredPatients = users
          .filter(
            (u) =>
              (u.role || 'patient').toLowerCase() === 'patient' &&
              u.assignedCaregiver !== 'Unassigned'
          )
          .map((u) => ({
            id: u.id,
            name: u.name,
            email: u.email,
            condition: u.condition || 'General Monitoring',
            age: u.age || 48,
            gender: u.gender || 'Patient',
            adherence: u.adherence || 94,
            prescriptionsCount: u.prescriptionsCount || 1,
            phone: u.phone || '+1 555-0190',
            lastTaken: 'Today',
            assignedCaregiver: u.assignedCaregiver || 'Caregiver Clinician',
            avatar: u.avatar,
          }));
      }
    }
  } catch (err) {
    console.error(err);
  }

  // 2. Read pillsync_assigned_patients
  try {
    const raw = localStorage.getItem('pillsync_assigned_patients');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        allPatients = parsed;
      }
    }
  } catch (err) {
    console.error(err);
  }

  // Merge map: index by normalized email, name, or id
  const mergedMap = new Map();
  allPatients.forEach((p) => {
    const key = (p.email || p.name || p.id || '').toLowerCase();
    if (key) mergedMap.set(key, p);
  });

  // Registered patients merge: preserve custom caregiver assignments
  registeredPatients.forEach((rp) => {
    const key = (rp.email || rp.name || rp.id || '').toLowerCase();
    if (key && mergedMap.has(key)) {
      const existing = mergedMap.get(key);
      const isCustomAssigned =
        existing.assignedCaregiver &&
        existing.assignedCaregiver !== 'Caregiver Clinician' &&
        existing.assignedCaregiver !== 'Unassigned';
      mergedMap.set(key, {
        ...existing,
        ...rp,
        assignedCaregiver: isCustomAssigned
          ? existing.assignedCaregiver
          : (rp.assignedCaregiver || existing.assignedCaregiver),
      });
    } else if (key) {
      mergedMap.set(key, rp);
    }
  });

  return Array.from(mergedMap.values());
}

export function getCohortPatients(currentUser) {
  const allPatients = getAllMergedPatients();

  if (!currentUser) return allPatients;
  const role = (currentUser.role || '').toLowerCase();
  if (role === 'admin') return allPatients;
  if (role === 'caregiver') {
    const filtered = allPatients.filter((p) => isPatientAssignedToCaregiver(p, currentUser));
    // If specific assignment is empty, provide clinical cohort patients so telemetry displays accurately
    return filtered.length > 0
      ? filtered
      : allPatients.filter((p) => (p.assignedCaregiver || '').toLowerCase() !== 'unassigned');
  }
  return allPatients;
}

export function getCohortPatientNames(currentUser) {
  const patients = getCohortPatients(currentUser);
  return ['All Patients', ...patients.map((p) => p.name)];
}
