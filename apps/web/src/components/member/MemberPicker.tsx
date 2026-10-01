import { Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useGym, useToday } from '../../data/store'
import { statusPill, viewMember } from '../../lib/present'
import { initials, maskCellphone, memberCode, memberName, type Member } from '../../lib/types'
import { Avatar, EmptyState, Pill } from '../ui'
import { Modal } from '../ui/Modal'
import { matchesSearch } from './search'

/** Pick a member to log a payment for (from the Today screen). */
export function MemberPicker({ open, onClose, onPick, title }: { open: boolean; onClose: () => void; onPick: (m: Member) => void; title: string }) {
  const { members } = useGym()
  const today = useToday()
  const [q, setQ] = useState('')
  const results = useMemo(() => members.data.filter((m) => matchesSearch(m, q)).slice(0, 8), [members.data, q])
  return (
    <Modal open={open} onClose={onClose} eyebrow="Choose a member" title={title} width="md">
      <div className="flex h-52 items-center gap-10 rounded-full bg-field px-20 focus-within:outline-3 focus-within:outline-offset-3 focus-within:outline-ink">
        <Search size={18} className="text-muted" aria-hidden />
        <input
          autoFocus
          data-autofocus
          aria-label="Search members"
          placeholder="Search name, cellphone or GY-number"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="min-w-0 flex-1 border-none bg-transparent text-15 outline-none"
        />
      </div>
      <div className="-mt-8 flex flex-col">
        {results.length === 0 ? (
          <EmptyState title="No members found">Check the spelling, or search by cellphone or GY-number.</EmptyState>
        ) : (
          results.map((m) => {
            const pill = statusPill(viewMember(m, today).info)
            return (
              <button key={m.id} type="button" onClick={() => onPick(m)} className="flex items-center gap-14 rounded-row border-t border-line-5 px-8 py-12 text-left hover:bg-field">
                <Avatar text={initials(memberName(m))} size={44} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-16 font-semibold">{memberName(m)}</span>
                  <span className="mt-2 block text-13 text-muted tabular">
                    {memberCode(m.number)} · {maskCellphone(m.cellphone)}
                  </span>
                </span>
                <Pill tone={pill.tone}>{pill.text}</Pill>
              </button>
            )
          })
        )}
      </div>
    </Modal>
  )
}
