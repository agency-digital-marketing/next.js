import path from 'path'
import fs from 'fs-extra'
import resolveFrom from 'resolve-from'
import { spawn, SpawnOptions } from 'child_process'
import { NextInstance } from './base'

export class NextStartInstance extends NextInstance {
  private _buildId: string
  private _cliOutput: string

  public get buildId() {
    return this._buildId
  }

  public get cliOutput() {
    return this._cliOutput
  }

  public async setup() {
    await super.createTestDir()
  }

  public async start() {
    if (this.childProcess) {
      throw new Error('next already started')
    }
    const spawnOpts: SpawnOptions = {
      cwd: this.testDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
      env: {
        ...process.env,
        NODE_ENV: '' as any,
        __NEXT_TEST_MODE: '1',
        __NEXT_RAND_PORT: '1',
      },
    }
    const handleStdio = () => {
      this.childProcess.stdout.on('data', (chunk) => {
        const msg = chunk.toString()
        process.stdout.write(chunk)
        this._cliOutput += msg
        this.emit('stdout', [msg])
      })
      this.childProcess.stderr.on('data', (chunk) => {
        const msg = chunk.toString()
        process.stderr.write(chunk)
        this._cliOutput += msg
        this.emit('stderr', [msg])
      })
    }
    const nextDir = path.dirname(resolveFrom(this.testDir, 'next/package.json'))

    this.childProcess = spawn(
      'node',
      [path.join(nextDir, '/dist/bin/next'), 'build'],
      spawnOpts
    )
    handleStdio()

    await new Promise<void>((resolve, reject) => {
      this.childProcess.on('exit', (code) => {
        if (code) reject(new Error(`next build failed with code ${code}`))
        else resolve()
      })
    })
    this._buildId = (
      await fs.readFile(
        path.join(
          this.testDir,
          this.nextConfig?.distDir || '.next',
          'BUILD_ID'
        ),
        'utf8'
      )
    ).trim()
    // we don't use yarn next here as yarn detaches itself from the
    // child process making it harder to kill all processes
    this.childProcess = spawn(
      'node',
      [path.join(nextDir, '/dist/bin/next'), 'start'],
      spawnOpts
    )
    handleStdio()

    this.childProcess.on('close', (code) => {
      if (this.isStopping) return
      if (code) {
        throw new Error(`next start exited unexpectedly with code ${code}`)
      }
    })

    await new Promise<void>((resolve) => {
      const readyCb = (msg) => {
        if (msg.includes('started server on') && msg.includes('url:')) {
          this._url = msg.split('url: ').pop().trim()
          this._parsedUrl = new URL(this._url)
          this.off('stdout', readyCb)
          resolve()
        }
      }
      this.on('stdout', readyCb)
    })
  }
}
