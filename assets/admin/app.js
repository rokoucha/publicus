const form = document.querySelector('#upload')
const picker = document.querySelector('#file')
const submit = form.querySelector('button')
const status = document.querySelector('#status')
const published = document.querySelector('#published')
const list = document.querySelector('#files')
const more = document.querySelector('#more')
const date = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
const size = new Intl.NumberFormat(undefined)
const api = '/admin/api/files'
let cursor = null

async function request(path, options) {
  const response = await fetch(path, options)
  if (!response.ok) {
    const detail = await response.json().catch(() => null)
    throw new Error(detail?.error ?? `操作に失敗しました (${response.status})`)
  }
  if (response.redirected) throw new Error('管理画面を再読み込みしてログインしてください')
  return response.status === 204 ? null : response.json()
}

function link(file) {
  const anchor = document.createElement('a')
  anchor.href = file.url
  anchor.target = '_blank'
  anchor.rel = 'noopener noreferrer'
  anchor.textContent = file.name
  return anchor
}

function copyButton(file) {
  const button = document.createElement('button')
  button.textContent = 'URLをコピー'
  button.onclick = async () => {
    try {
      await navigator.clipboard.writeText(file.url)
      status.textContent = '共有URLをコピーしました'
    } catch {
      status.textContent = 'コピーできませんでした'
    }
  }
  return button
}

function row(file) {
  const item = document.createElement('li')
  item.dataset.id = file.id
  const title = document.createElement('span')
  const details = document.createElement('small')
  details.textContent = `${date.format(new Date(file.createdAt))} · ${size.format(file.size)} B`
  title.append(link(file), details)
  const remove = document.createElement('button')
  remove.textContent = '削除'
  remove.onclick = async () => {
    if (!confirm(`「${file.name}」を削除しますか？`)) return
    remove.disabled = true
    try {
      await request(api + '/' + file.id, { method: 'DELETE' })
      item.remove()
      if (published.dataset.id === file.id) published.hidden = true
      status.textContent = '削除しました'
    } catch (error) {
      status.textContent = error.message
      remove.disabled = false
    }
  }
  item.append(title, copyButton(file), remove)
  return item
}

async function load() {
  more.disabled = true
  try {
    const path = cursor ? api + '?' + new URLSearchParams({ cursor }) : api
    const page = await request(path)
    for (const file of page.files) {
      if (!list.querySelector(`[data-id="${file.id}"]`)) list.append(row(file))
    }
    cursor = page.cursor
    more.hidden = !cursor
  } catch (error) {
    status.textContent = error.message
    more.hidden = false
  } finally {
    more.disabled = false
  }
}

form.onsubmit = async event => {
  event.preventDefault()
  const file = picker.files[0]
  if (!file) return
  submit.disabled = true
  status.textContent = 'アップロード中'
  try {
    const created = await request(api, {
      method: 'POST', headers: { 'X-File-Name': encodeURIComponent(file.name) }, body: file,
    })
    if (!list.querySelector(`[data-id="${created.id}"]`)) list.prepend(row(created))
    published.dataset.id = created.id
    published.replaceChildren(link(created), ' ', copyButton(created))
    published.hidden = false
    form.reset()
    status.textContent = 'アップロードしました'
  } catch (error) {
    status.textContent = error.message
  } finally {
    submit.disabled = false
  }
}

more.onclick = load
load()
