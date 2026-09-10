'use client'

import { useState } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Button } from '@/components/ui/button'

import { EyeIcon, EyeOffIcon } from 'lucide-react'
import { RiUserFill } from '@remixicon/react'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [isVisible, setIsVisible] = useState(false)

  const toggleVisibility = () => setIsVisible((prev) => !prev)

  async function handleLogin(e) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const result = await signIn('credentials', {
      email,
      password,
      redirect: false,
    })

    setLoading(false)

    if (result?.error) {
      setError('Email atau password salah')
      return
    }

    const res = await fetch('/api/auth/session')
    const session = await res.json()

    if (session?.user?.role === 'KEPALA_SEKOLAH') {
      router.push('/ks/dashboard')
    } else {
      router.push('/guru/dashboard')
    }
  }

  return (
    <div className="min-h-screen flex items-start justify-center bg-gray-50 p-4 pt-25">
      <Card className="flex w-full max-w-[440px] shadow-none flex-col gap-6 p-5 md:p-8">
        <CardHeader className="flex flex-col items-center gap-2">
          <div className="relative flex size-[68px] shrink-0 items-center justify-center rounded-full backdrop-blur-xl md:size-24 before:absolute before:inset-0 before:rounded-full before:bg-gradient-to-b before:from-neutral-500 before:to-transparent before:opacity-10">
            <div className="relative z-10 flex size-12 items-center justify-center rounded-full bg-background shadow-xs ring-1 ring-inset ring-border md:size-16">
              <RiUserFill className="size-6 text-muted-foreground/80 md:size-8" />
            </div>
          </div>

          <div className="flex flex-col space-y-1.5 text-center">
            <CardTitle className="md:text-xl font-medium">
              Management Cuti
            </CardTitle>
            <CardDescription className="tracking-[-0.006em]">
              Sistem Pengajuan Cuti Guru
            </CardDescription>
          </div>
        </CardHeader>

        <Separator />

        <CardContent className="p-0">
          <form className="flex flex-col gap-4" onSubmit={handleLogin}>
            <div className="flex flex-col gap-2.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="email@sekolah.sch.id"
                required
                className="rounded-lg"
              />
            </div>

            <div className="flex flex-col gap-2.5">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  className="pe-9 rounded-lg"
                  placeholder="Masukkan password"
                  type={isVisible ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <button
                  className="text-muted-foreground/80 hover:text-foreground absolute inset-y-0 end-0 flex h-full w-9 items-center justify-center rounded-e-md transition-colors outline-none disabled:pointer-events-none disabled:opacity-50"
                  type="button"
                  onClick={toggleVisibility}
                  aria-label={isVisible ? 'Hide password' : 'Show password'}
                  aria-pressed={isVisible}
                  aria-controls="password"
                >
                  {isVisible ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
                </button>
              </div>
            </div>

            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-600">
                {error}
              </div>
            )}

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Memproses...' : 'Masuk'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}