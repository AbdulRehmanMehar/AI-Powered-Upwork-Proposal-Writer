import { auth } from '@/lib/auth';
import { NextResponse } from 'next/server';

// Routes that require authentication
const protectedRoutes = ['/', '/settings'];
// Routes that should redirect to home if already authenticated
const authRoutes = ['/login', '/register'];

export const proxy = auth((req) => {
  const { nextUrl } = req;
  const isLoggedIn = !!req.auth;
  
  const isProtectedRoute = protectedRoutes.includes(nextUrl.pathname);
  const isAuthRoute = authRoutes.includes(nextUrl.pathname);
  const isApiRoute = nextUrl.pathname.startsWith('/api');
  
  // Allow public API routes (usage stats can be public)
  if (isApiRoute && nextUrl.pathname === '/api/usage') {
    return NextResponse.next();
  }
  
  // Protect proposal API routes
  if (isApiRoute && nextUrl.pathname.startsWith('/api/proposals')) {
    if (!isLoggedIn) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }
    return NextResponse.next();
  }
  
  // Protect profile API route
  if (isApiRoute && nextUrl.pathname === '/api/profile') {
    if (!isLoggedIn) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }
    return NextResponse.next();
  }
  
  // If on auth routes and logged in, redirect to home
  if (isAuthRoute && isLoggedIn) {
    return NextResponse.redirect(new URL('/', nextUrl));
  }
  
  // If on protected route and not logged in, redirect to login
  if (isProtectedRoute && !isLoggedIn) {
    const loginUrl = new URL('/login', nextUrl);
    loginUrl.searchParams.set('callbackUrl', nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }
  
  return NextResponse.next();
});

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public files (icons, manifest, sw.js)
     */
    '/((?!_next/static|_next/image|favicon.ico|icons|manifest.json|sw.js).*)',
  ],
};
