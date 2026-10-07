/** Shared validation constants and helpers — used by both the Worker and the frontend. */

export const HOSTELS = [
  'Aravali', 'Jwalamukhi', 'Karakoram', 'Kumaon', 'Nilgiri',
  'Shivalik', 'Satpura', 'Vindhyachal', 'Zanskar', 'Kailash',
  'Himadri', 'Udaigiri', 'Girnar', 'Dronagiri', 'Sahyadri',
  'Day Scholar',
] as const

export type Hostel = typeof HOSTELS[number]

/** Format: 4 digits, 2 uppercase letters, 5 digits  e.g. 2023CS10123 */
export const ENTRY_NUMBER_REGEX = /^\d{4}[A-Z]{2}\d{5}$/

export function normalizeEntryNumber(s: string): string {
  return s.trim().toUpperCase()
}

export interface MemberInput {
  name: string
  entryNumber: string
  hostel: string
}

export interface RegistrationInput {
  teamName: string
  members: [MemberInput, MemberInput]
}

export interface ValidationError {
  field: string
  message: string
}

export function validateRegistration(input: RegistrationInput): ValidationError[] {
  const errors: ValidationError[] = []

  const name = (input.teamName ?? '').trim()
  if (!name) {
    errors.push({ field: 'teamName', message: 'Team name is required' })
  } else if (name.length < 2) {
    errors.push({ field: 'teamName', message: 'Team name must be at least 2 characters' })
  } else if (name.length > 30) {
    errors.push({ field: 'teamName', message: 'Team name must be at most 30 characters' })
  }

  if (!Array.isArray(input.members) || input.members.length !== 2) {
    errors.push({ field: 'members', message: 'Exactly 2 members required' })
    return errors
  }

  const entryNumbers: string[] = []
  input.members.forEach((m, i) => {
    const pre = `members[${i}]`
    const memberName = (m.name ?? '').trim()
    if (!memberName) errors.push({ field: `${pre}.name`, message: `Member ${i + 1} name is required` })

    const en = normalizeEntryNumber(m.entryNumber ?? '')
    if (!ENTRY_NUMBER_REGEX.test(en)) {
      errors.push({
        field: `${pre}.entryNumber`,
        message: `Member ${i + 1} entry number must be in format YYYYDDNNNNN (e.g. 2023CS10123)`,
      })
    } else {
      entryNumbers.push(en)
    }

    if (!HOSTELS.includes(m.hostel as Hostel)) {
      errors.push({ field: `${pre}.hostel`, message: `Member ${i + 1} hostel is not valid` })
    }
  })

  if (entryNumbers.length === 2 && entryNumbers[0] === entryNumbers[1]) {
    errors.push({ field: 'members[1].entryNumber', message: 'Both members cannot have the same entry number' })
  }

  return errors
}
