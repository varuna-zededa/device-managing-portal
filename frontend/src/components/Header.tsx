import { LogOut, ChevronDown } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { useUser } from '@/context/UserContext'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu'
import { NotificationBell } from '@/components/NotificationPanel'
import { cn } from '@/lib/utils'

function initials(name: string) {
  return name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

export function Header() {
  const { currentUser, isAdmin, logout } = useUser()

  if (!currentUser) return null

  return (
    <header className="fixed top-0 inset-x-0 z-50 h-14 border-b border-border bg-background/95 backdrop-blur flex items-center px-4 gap-4">
      <div className="flex items-center gap-6 flex-1">
        <div className="flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <img src="/holocron.png" alt="Holocron" className="w-6 h-6 object-contain cursor-default" />
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>A Holocron holds all knowledge — who owns what, what state it's in, and the full history.</p>
              <p className="text-muted-foreground mt-0.5">May the Force be with your lab.</p>
            </TooltipContent>
          </Tooltip>
          <span className="font-semibold text-foreground">Holocron</span>
        </div>
        <nav className="flex items-center gap-1">
          {[{ to: '/devices', label: 'Devices' }, { to: '/users', label: 'Users' }].map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) => cn(
                'px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
                isActive
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent/60',
              )}
            >
              {label}
            </NavLink>
          ))}
        </nav>
      </div>

      <div className="flex items-center gap-2">
        <NotificationBell />

        <DropdownMenu>
          <DropdownMenuTrigger className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
            <Avatar className="w-7 h-7">
              <AvatarFallback className="text-xs">{initials(currentUser.name)}</AvatarFallback>
            </Avatar>
            <span className="text-sm font-bold text-foreground hidden sm:block">{currentUser.name}</span>
            {isAdmin && (
              <Badge variant="default" className="text-xs px-1.5 py-0 h-4 hidden sm:flex">
                Admin
              </Badge>
            )}
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="font-normal">
              <div className="space-y-1">
                <p className="text-sm font-medium">{currentUser.name}</p>
                <p className="text-xs text-muted-foreground">{currentUser.email}</p>
                <p className="text-xs text-muted-foreground">Team: {currentUser.team}</p>
                <p className="text-xs text-muted-foreground capitalize">Role: {currentUser.user_type.replace('_', ' ')}</p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={logout} className="text-destructive focus:text-destructive gap-2">
              <LogOut className="w-4 h-4" aria-hidden="true" />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
