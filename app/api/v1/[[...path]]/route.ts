import { handle } from "@/lib/handle";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

async function go(request: Request, context: { params: Promise<{ path?: string[] }> }, method: string) {
  const { path = [] } = await context.params;
  return handle(method, path, request);
}

export function GET(request: Request, context: { params: Promise<{ path?: string[] }> }) {
  return go(request, context, "GET");
}

export function POST(request: Request, context: { params: Promise<{ path?: string[] }> }) {
  return go(request, context, "POST");
}

export function PATCH(request: Request, context: { params: Promise<{ path?: string[] }> }) {
  return go(request, context, "PATCH");
}

export function DELETE(request: Request, context: { params: Promise<{ path?: string[] }> }) {
  return go(request, context, "DELETE");
}
