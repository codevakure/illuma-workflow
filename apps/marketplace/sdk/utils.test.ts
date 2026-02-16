import { describe, expect, it, vi } from 'vitest'
import { validateUrl } from './utils'

describe('validateUrl', () => {
  it('allows valid external URLs', () => {
    expect(() => validateUrl('https://api.slack.com/chat.postMessage')).not.toThrow()
    expect(() => validateUrl('https://en.wikipedia.org/w/api.php')).not.toThrow()
    expect(() => validateUrl('https://api.github.com/repos')).not.toThrow()
  })

  it('blocks localhost', () => {
    expect(() => validateUrl('http://localhost:3001/api')).toThrow('Blocked request to localhost')
    expect(() => validateUrl('http://127.0.0.1:8080')).toThrow('Blocked request to localhost')
    expect(() => validateUrl('http://0.0.0.0')).toThrow('Blocked request to localhost')
  })

  it('blocks private 10.x.x.x range', () => {
    expect(() => validateUrl('http://10.0.0.1')).toThrow('Blocked request to private IP')
    expect(() => validateUrl('http://10.255.255.255')).toThrow('Blocked request to private IP')
  })

  it('blocks private 172.16-31.x.x range', () => {
    expect(() => validateUrl('http://172.16.0.1')).toThrow('Blocked request to private IP')
    expect(() => validateUrl('http://172.31.255.255')).toThrow('Blocked request to private IP')
  })

  it('allows 172.32+ (not private)', () => {
    expect(() => validateUrl('http://172.32.0.1')).not.toThrow()
  })

  it('blocks private 192.168.x.x range', () => {
    expect(() => validateUrl('http://192.168.0.1')).toThrow('Blocked request to private IP')
    expect(() => validateUrl('http://192.168.1.100')).toThrow('Blocked request to private IP')
  })

  it('blocks link-local 169.254.x.x', () => {
    expect(() => validateUrl('http://169.254.169.254')).toThrow('Blocked request to private IP')
  })

  it('throws for invalid URLs', () => {
    expect(() => validateUrl('not-a-url')).toThrow()
  })
})
