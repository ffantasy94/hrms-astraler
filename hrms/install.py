import click

from hrms.setup import after_install as setup


def after_install():
	try:
		print("Setting up Astraler HR...")
		setup()

		click.secho("Thank you for installing Astraler HR!", fg="green")

	except Exception as e:
		BUG_REPORT_URL = "https://github.com/ffantasy94/hrms-astraler/issues/new"
		click.secho(
			"Installation for Astraler HR app failed due to an error."
			" Please try re-installing the app or"
			f" report the issue on {BUG_REPORT_URL} if not resolved.",
			fg="bright_red",
		)
		raise e
