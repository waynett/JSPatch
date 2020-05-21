require("UIAlertView");

defineClass('JPViewController', {
  handleBtn: function(sender) {
       
    var alert = UIAlertView.alloc().initWithTitle_message_delegate_cancelButtonTitle_otherButtonTitles("JSPatchAmend", "Success", null, "Yes", null, null);
    alert.show();

  }
})
