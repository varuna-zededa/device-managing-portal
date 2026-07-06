import { Server, LogOut, ChevronDown } from 'lucide-react'
import { useUser } from '@/context/UserContext'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu'
import { NotificationBell } from '@/components/NotificationPanel'

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
      <div className="flex items-center gap-2 flex-1">
        <Server className="w-5 h-5 text-primary" />
        <span className="font-semibold text-foreground">Device Portal</span>
      </div>

      <div className="flex items-center gap-2">
        <NotificationBell />

        <DropdownMenu>
          <DropdownMenuTrigger className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent transition-colors outline-none">
            <Avatar className="w-7 h-7">
              <AvatarFallback className="text-xs">{initials(currentUser.name)}</AvatarFallback>
            </Avatar>
            <span className="text-sm font-medium hidden sm:block">{currentUser.name}</span>
            {isAdmin && (
              <Badge variant="default" className="text-xs px-1.5 py-0 h-4 hidden sm:flex">
                Admin
              </Badge>
            )}
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
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
              <LogOut className="w-4 h-4" />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
