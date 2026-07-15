import { expect, getMockState, selectAllModifier, test } from './support/test'

test('manages macOS resolver files from the domain resolution view', async ({ page }) => {
  await page.getByLabel('Domain Resolution').click()

  await expect(page.getByText('corp.example', { exact: true }).last()).toBeVisible()
  await expect(page.getByText('dev.example', { exact: true }).last()).toBeVisible()
  await expect(page.getByText('/etc/resolver/corp.example', { exact: true })).toBeVisible()

  const editor = page.locator('.cm-content')
  await expect(editor).toContainText('nameserver 192.0.2.53')
  await editor.click()
  await page.keyboard.press(`${selectAllModifier}+A`)
  await page.keyboard.type('nameserver 203.0.113.53\nnameserver 198.51.100.53\n')
  await page.getByRole('button', { name: 'Save', exact: true }).click()

  await expect
    .poll(async () => (await getMockState(page)).resolvers['corp.example'].content)
    .toBe('nameserver 203.0.113.53\nnameserver 198.51.100.53\n')

  const prodSwitch = page.getByRole('switch', { name: 'Domain Resolution corp.example' })
  await prodSwitch.click()
  await expect(prodSwitch).toHaveAttribute('aria-checked', 'false')
  await expect
    .poll(async () => {
      const state = await getMockState(page)
      return {
        enabled: state.resolvers['corp.example'].enabled,
        persisted: state.resolvers['corp.example'].content,
        systemFileExists: Object.prototype.hasOwnProperty.call(
          state.systemResolvers,
          'corp.example',
        ),
      }
    })
    .toEqual({
      enabled: false,
      persisted: 'nameserver 203.0.113.53\nnameserver 198.51.100.53\n',
      systemFileExists: false,
    })

  await editor.click()
  await page.keyboard.press(`${selectAllModifier}+A`)
  await page.keyboard.type('nameserver 192.0.2.54\n')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect
    .poll(async () => {
      const state = await getMockState(page)
      return {
        persisted: state.resolvers['corp.example'].content,
        systemFileExists: Object.prototype.hasOwnProperty.call(
          state.systemResolvers,
          'corp.example',
        ),
      }
    })
    .toEqual({ persisted: 'nameserver 192.0.2.54\n', systemFileExists: false })

  await prodSwitch.click()
  await expect(prodSwitch).toHaveAttribute('aria-checked', 'true')
  await expect
    .poll(async () => (await getMockState(page)).systemResolvers['corp.example'])
    .toBe('nameserver 192.0.2.54\n')

  await page.getByLabel('Add').click()
  await page.getByLabel('Resolver name').fill('vpn.example')
  await page.getByRole('button', { name: 'OK', exact: true }).click()
  await expect(page.getByText('vpn.example', { exact: true }).last()).toBeVisible()
  const template = (await getMockState(page)).resolvers['vpn.example'].content
  for (const directive of [
    'nameserver',
    'port',
    'domain',
    'search',
    'search_order',
    'sortlist',
    'timeout',
    'options',
  ]) {
    expect(template).toContain(`# ${directive}`)
  }

  const row = page.getByText('vpn.example', { exact: true }).last().locator('..')
  await row.hover()
  await row.getByLabel('Edit').click()
  await page.getByLabel('Resolver name').fill('private.example')
  await page.getByRole('button', { name: 'OK', exact: true }).click()
  await expect(page.getByText('private.example', { exact: true }).last()).toBeVisible()

  const renamedRow = page.getByText('private.example', { exact: true }).last().locator('..')
  await renamedRow.hover()
  await renamedRow.getByLabel('Delete').click()
  await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(page.getByText('private.example', { exact: true })).toHaveCount(0)
})
