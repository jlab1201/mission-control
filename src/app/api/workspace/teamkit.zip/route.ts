import { NextResponse } from 'next/server';
import archiver from 'archiver';
import { Readable } from 'stream';
import { TEAM_KIT_SOURCE } from '@/server/workspace/install';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse> {
  try {
    const archive = archiver('zip', { zlib: { level: 6 } });

    archive.glob('**/*', {
      cwd: TEAM_KIT_SOURCE,
      dot: true,
      ignore: ['node_modules/**', '.git/**'],
    });

    // Collect the zip into a Buffer so we can return it as a NextResponse
    const chunks: Buffer[] = [];
    const bufferPromise = new Promise<Buffer>((resolve, reject) => {
      archive.on('data', (chunk: Buffer) => chunks.push(chunk));
      archive.on('end', () => resolve(Buffer.concat(chunks)));
      archive.on('error', reject);
    });

    // archive.finalize() is async but signals completion via 'end' event
    archive.finalize();

    const buffer = await bufferPromise;

    return new NextResponse(Readable.toWeb(Readable.from(buffer)) as ReadableStream, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename="team-kit.zip"',
        'Content-Length': String(buffer.length),
      },
    });
  } catch (err) {
    console.error('[GET /api/workspace/teamkit.zip]', err);
    return NextResponse.json(
      { error: 'Failed to create zip' },
      { status: 500 }
    );
  }
}
